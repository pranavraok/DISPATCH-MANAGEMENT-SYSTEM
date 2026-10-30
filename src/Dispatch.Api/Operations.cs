using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public record Command(string RequestId, string Type, JsonElement Data);
public record GroupDraft(string Name, string WarehouseId, string? CustomerId, string Notes, PackedGroup[] Groups, string? Id = null, int Version = 0);
public record RateLine(string Sku, decimal Rate, decimal DiscountPercent);
public record BillDraft(string ShipmentId, RateLine[] Rates, decimal Freight, decimal OtherCharges, string Reason, string Terms, int Version);
public static class Permissions
{
    public static readonly string[] Roles = ["Admin", "PackingClerk", "PackingSupervisor", "Loader", "DispatchSupervisor", "Billing", "MD"];
    public static void Require(User u, params string[] roles) { if (!u.Roles.Contains("Admin") && !u.Roles.Intersect(roles).Any()) throw new RuleException("Your role cannot perform this action.", 403); }
}
public sealed class Operations(DispatchDb db)
{
    User actor = null!;
    string company = "";
    static string NewId(string prefix) => prefix + Guid.NewGuid().ToString("N")[..20].ToUpperInvariant();
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    static string Str(JsonElement d, string key) => d.TryGetProperty(key, out var v) ? v.GetString()?.Trim() ?? "" : "";
    static bool Flag(JsonElement d, string key) => d.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True;
    static string[] Ids(JsonElement d) => Json.Read<string[]>(d.GetProperty("ids"));
    static void Check(bool condition, string error, int status = 400) { if (!condition) throw new RuleException(error, status); }
    public async Task<T> Get<T>(string id) where T : Scoped => await db.Set<T>().SingleOrDefaultAsync(x => x.Id == id && x.CompanyId == company) ?? throw new RuleException("Record unavailable in your company.", 404);
    void RequireReason(JsonElement d) => Check(Str(d, "reason").Length >= 3, "A meaningful reason is required.");
    void Audit(string action, string entity, object data) { var e = new AuditEvent { CompanyId = company, ActorId = actor.Id, Action = action, EntityId = entity, Data = Json.Write(data) }; db.Audit.Add(e); db.Outbox.Add(new OutboxEvent { CompanyId = company, AuditId = e.Id }); }
    public async Task<object> Execute(User user, Command cmd)
    {
        actor = user; company = user.CompanyId;
        Check(Guid.TryParse(cmd.RequestId, out _), "Request ID must be a UUID.");
        // One company-scoped transaction serializes conflicting operations initially. This is deliberately conservative;
        // replace with resource locks only after the repeatable concurrency suite and measured workloads justify it.
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({company},0))");
        var fingerprint = Hash(cmd.Type + "|" + cmd.Data.GetRawText());
        var old = await db.Requests.SingleOrDefaultAsync(x => x.CompanyId == company && x.Id == cmd.RequestId);
        if (old != null) { Check(old.ActorId == actor.Id && old.Fingerprint == fingerprint, "Request ID was already used with different input or operator.", 409); return Json.Read<JsonElement>(old.Response); }
        var result = await Handle(cmd.Type, cmd.Data);
        var savedResponse = cmd.Type == "pairConnector" ? Json.Write(new { message = "Pairing already created. Credential is shown only on the original response. Revoke and pair again if it was lost." }) : Json.Write(result);
        db.Requests.Add(new RequestRecord { Id = cmd.RequestId, CompanyId = company, ActorId = actor.Id, Fingerprint = fingerprint, Response = savedResponse });
        if (cmd.Type != "pairConnector" && cmd.Type != "createUser") Audit(cmd.Type, Str(cmd.Data, "id"), new { input = cmd.Data, result });
        await db.SaveChangesAsync(); await tx.CommitAsync(); return result;
    }
    async Task<object> Handle(string type, JsonElement d)
    {
        switch (type)
        {
            case "saveProduct":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d); var sku = Str(d, "sku"); Check(sku.Length is >= 1 and <= 50 && Str(d, "name").Length >= 2 && Str(d, "unit").Length >= 1, "Exact SKU, name and base unit required."); var p = await db.Products.SingleOrDefaultAsync(x => x.CompanyId == company && x.Sku == sku); if (p == null) { p = new Product { CompanyId = company, Sku = sku }; db.Products.Add(p); } else Check(p.Unit == Str(d, "unit") || !await db.Cartons.AnyAsync(c => c.CompanyId == company && c.Lines.Contains(sku)), "Cannot change a unit already captured in carton snapshots."); var before = new { p.Name, p.Unit, p.TallyId, p.TallyName }; p.Name = Str(d, "name"); p.Unit = Str(d, "unit"); p.TallyId = Str(d, "tallyId") is { Length: > 0 } native ? native : null; p.TallyName = Str(d, "tallyName") is { Length: > 0 } name ? name : null; Audit("productMapping", p.Id, new { before, sku, reason = Str(d, "reason") }); return new { id = p.Id, message = "Operational product mapping saved. No Tally master was created." };
                }
            case "saveCustomer":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d); Check(Str(d, "name").Length >= 2 && Str(d, "address").Length >= 3, "Customer name and delivery address required."); var id = Str(d, "id"); var c = id.Length > 0 ? await Get<Customer>(id) : new Customer { CompanyId = company }; if (id.Length == 0) db.Customers.Add(c); var before = new { c.Name, c.Address, c.TallyId, c.GstIn }; c.Name = Str(d, "name"); c.Address = Str(d, "address"); c.TallyId = Str(d, "tallyId") is { Length: > 0 } native ? native : null; c.GstIn = Str(d, "gstIn") is { Length: > 0 } gst ? gst : null; Audit("customerMapping", c.Id, new { before, reason = Str(d, "reason") }); return new { id = c.Id, message = "Customer mapping saved. Validate the accountant's actual ledger." };
                }
            case "saveConversion":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d); var p = await Get<Product>(Str(d, "productId")); var factor = d.GetProperty("factor").ValueKind == JsonValueKind.String ? decimal.Parse(Str(d, "factor"), System.Globalization.CultureInfo.InvariantCulture) : d.GetProperty("factor").GetDecimal(); Check(factor > 0 && factor <= 1000000 && decimal.Round(factor, 6) == factor && Str(d, "fromUnit").Length >= 1 && Str(d, "fromUnit") != p.Unit, "Provide a positive exact conversion into the base unit."); var unit = Str(d, "fromUnit"); var conversion = await db.Conversions.SingleOrDefaultAsync(x => x.CompanyId == company && x.ProductId == p.Id && x.FromUnit == unit && x.BaseUnit == p.Unit); if (conversion == null) { conversion = new UnitConversion { CompanyId = company, ProductId = p.Id, FromUnit = unit, BaseUnit = p.Unit }; db.Conversions.Add(conversion); }
                    conversion.Factor = factor; return new { message = "Explicit conversion saved. Existing approved carton snapshots are unchanged." };
                }
            case "saveManifest":
            case "importManifest":
                {
                    Permissions.Require(actor, "PackingClerk", "PackingSupervisor"); var input = Json.Read<GroupDraft>(d);
                    Check(input.Name.Length is >= 3 and <= 120, "Provide a name between 3 and 120 characters."); await Get<Warehouse>(input.WarehouseId);
                    if (!string.IsNullOrEmpty(input.CustomerId)) await Get<Customer>(input.CustomerId);
                    await ValidateGroups(input.Groups); Manifest m;
                    if (input.Id != null) { m = await Get<Manifest>(input.Id); Check(m.State == "Draft", "Approved manifests are immutable."); Check(m.Version == input.Version, "Another operator changed this draft. Reload before saving.", 409); m.Version++; }
                    else { m = new Manifest { CompanyId = company, Id = NewId("PK-") }; db.Manifests.Add(m); }
                    m.Name = input.Name; m.WarehouseId = input.WarehouseId; m.CustomerId = input.CustomerId; m.Notes = input.Notes; m.Groups = Json.Write(input.Groups);
                    return new { id = m.Id, version = m.Version, message = "Draft saved. Physical approval is still required." };
                }
            case "approveManifest":
                {
                    Permissions.Require(actor, "PackingSupervisor"); Check(Flag(d, "physicalConfirmed"), "Confirm the physical group markings and contents.");
                    var m = await Get<Manifest>(Str(d, "id")); if (m.State == "Approved") return new { id = m.Id, message = "Manifest was already approved. No new cartons created." };
                    Check(m.State == "Draft", "Manifest cannot be approved in this state.");
                    var groups = Json.Read<PackedGroup[]>(m.Groups); await ValidateGroups(groups);
                    foreach (var group in groups) for (var i = 0; i < group.Count; i++) db.Cartons.Add(new Carton { Id = NewId("CT-"), CompanyId = company, ManifestId = m.Id, WarehouseId = m.WarehouseId, CustomerId = m.CustomerId, Marking = group.Marking, Lines = Json.Write(await Normalize(group.Lines)) });
                    m.State = "Approved"; m.ApprovedBy = actor.Id; m.ApprovedAt = DateTimeOffset.UtcNow; m.Version++;
                    return new { id = m.Id, count = groups.Sum(g => g.Count), message = "Unique cartons created. Print, attach and verify their labels." };
                }
            case "createLabels":
                {
                    Permissions.Require(actor, "PackingClerk", "PackingSupervisor"); RequireReason(d); var cartons = await Selected(d);
                    Check(cartons.All(c => c.State is "Available" or "Reserved"), "Retired, loaded and dispatched labels cannot be reissued through the packing screen.");
                    var label = new LabelJob { CompanyId = company, OperatorId = actor.Id, Reason = Str(d, "reason"), CartonSnapshots = Json.Write(cartons.Select(c => new { c.Id, c.Revision, c.Marking, c.Lines, c.CompanyId, qr = $"K1|{company}|{c.Id}|{c.Revision}" })) }; db.Labels.Add(label);
                    return new { id = label.Id, cartons, message = "Label job prepared. A PDF download is not proof of printing or attachment." };
                }
            case "labelStatus":
                {
                    Permissions.Require(actor, "PackingClerk", "PackingSupervisor"); var job = await Get<LabelJob>(Str(d, "id")); var state = Str(d, "state");
                    Check(new[] { "Submitted", "Failed", "Unknown", "OperatorConfirmed" }.Contains(state), "Invalid print state."); RequireReason(d); job.State = state; return new { id = job.Id, message = "Print status recorded. Carton verification remains separate." };
                }
            case "attachLabels":
                {
                    Permissions.Require(actor, "PackingClerk", "PackingSupervisor"); Check(Flag(d, "physicalConfirmed"), "Confirm labels are physically attached to the correct boxes.");
                    var cartons = await Selected(d); foreach (var c in cartons) { Check(c.State == "Available" && !c.Held, "Only available, unheld cartons may be labelled."); c.Attached = true; }
                    return new { message = $"Attachment recorded for {cartons.Count} cartons. Scan verification is next." };
                }
            case "verifyCarton":
                {
                    Permissions.Require(actor, "PackingSupervisor"); Check(Flag(d, "physicalConfirmed"), "Confirm physical identity and actual contents."); var c = await ResolveQr(Str(d, "qr"));
                    Check(c.Attached && c.State == "Available" && !c.Held, "Attach the current label and clear holds before verification."); c.Verified = true; c.VerifiedBy = actor.Id; c.VerifiedAt = DateTimeOffset.UtcNow;
                    return new { id = c.Id, message = "Identity and contents verified." };
                }
            case "holdCarton":
                {
                    Permissions.Require(actor, "PackingSupervisor", "DispatchSupervisor"); RequireReason(d); var c = await Get<Carton>(Str(d, "id")); Check(c.State == "Available", "Unload and release allocations before changing a hold."); c.Held = Flag(d, "held"); return new { id = c.Id, message = c.Held ? "Carton held. Loading blocked." : "Hold cleared." };
                }
            case "reviseCarton":
                {
                    Permissions.Require(actor, "PackingSupervisor"); RequireReason(d); var c = await Get<Carton>(Str(d, "id")); Check(c.State == "Available", "Only unloaded, unallocated cartons can be revised."); var lines = Json.Read<ContentLine[]>(d.GetProperty("lines")); var previous = new { c.Revision, c.Lines }; c.Lines = Json.Write(await Normalize(lines)); c.Revision++; c.Verified = false; c.Attached = false; c.VerifiedAt = null; c.VerifiedBy = null; Audit("contentRevision", c.Id, new { previous, next = c.Lines, reason = Str(d, "reason") }); return new { id = c.Id, revision = c.Revision, message = "New label revision required. Previous QR is obsolete." };
                }
            case "repack":
                {
                    Permissions.Require(actor, "PackingSupervisor"); RequireReason(d); Check(Flag(d, "physicalConfirmed"), "Confirm a physical split or repack."); var oldCarton = await Get<Carton>(Str(d, "id")); Check(oldCarton.State == "Available", "Only unallocated cartons may be repacked."); var groups = Json.Read<PackedGroup[]>(d.GetProperty("groups")); await ValidateGroups(groups);
                    var original = Totals([oldCarton]); var replacement = groups.SelectMany(g => Enumerable.Repeat(g.Lines, g.Count)).SelectMany(x => x).GroupBy(l => l.Sku + "|" + l.Unit + "|" + l.Batch + "|" + l.Godown).ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity));
                    Check(original.Count == replacement.Count && original.All(x => replacement.GetValueOrDefault(x.Key) == x.Value), "Replacement contents must exactly preserve SKU, unit, batch, godown and quantities."); oldCarton.State = "Retired"; oldCarton.Verified = false;
                    var created = new List<string>(); foreach (var g in groups) for (var i = 0; i < g.Count; i++) { var c = new Carton { Id = NewId("CT-"), CompanyId = company, WarehouseId = oldCarton.WarehouseId, ManifestId = oldCarton.ManifestId, CustomerId = oldCarton.CustomerId, ParentCartonId = oldCarton.Id, Marking = g.Marking, Lines = Json.Write(await Normalize(g.Lines)) }; db.Cartons.Add(c); created.Add(c.Id); }
                    return new { ids = created, message = "Old carton retired. Attach and verify replacement labels." };
                }
            case "createTrip":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); Check(Str(d, "vehicle").Length >= 4 && Str(d, "driver").Length >= 2, "Vehicle and driver are required."); var trip = new Trip { Id = NewId("TR-"), CompanyId = company, Vehicle = Str(d, "vehicle"), Driver = Str(d, "driver"), Transporter = Str(d, "transporter") }; db.Trips.Add(trip); return new { id = trip.Id, message = "Vehicle trip created." };
                }
            case "updateTrip":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var t = await Get<Trip>(Str(d, "id")); Check(t.State == "Open", "Departed trip details are immutable."); Check(Str(d, "vehicle").Length >= 4 && Str(d, "driver").Length >= 2, "Vehicle and driver required."); var before = new { t.Vehicle, t.Driver }; t.Vehicle = Str(d, "vehicle"); t.Driver = Str(d, "driver"); Audit("vehicleCorrection", t.Id, new { before, after = new { t.Vehicle, t.Driver }, reason = Str(d, "reason") }); return new { message = "Vehicle details updated with history." };
                }
            case "allocate":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); var trip = await Get<Trip>(Str(d, "tripId")); Check(trip.State == "Open", "Trip has already departed."); var cust = await Get<Customer>(Str(d, "customerId")); Check(Str(d, "destination").Length >= 3, "Delivery destination required."); var cartons = await Selected(d);
                    Check(cartons.All(c => c.Verified && c.Attached && !c.Held && c.State == "Available"), "Every selected carton must be verified, unheld and available."); Check(cartons.Select(c => c.WarehouseId).Distinct().Count() == 1, "Select one warehouse per shipment."); Check(cartons.All(c => c.CustomerId == null || c.CustomerId == cust.Id), "Cartons assigned to another customer cannot be allocated.");
                    var s = new Shipment { Id = NewId("SH-"), CompanyId = company, TripId = trip.Id, CustomerId = cust.Id, WarehouseId = cartons[0].WarehouseId, Destination = Str(d, "destination") }; db.Shipments.Add(s);
                    foreach (var c in cartons) { c.State = "Reserved"; db.Allocations.Add(new Allocation { CompanyId = company, ShipmentId = s.Id, CartonId = c.Id }); }
                    return new { id = s.Id, message = $"{cartons.Count} cartons reserved for {cust.Name}. Remaining packed cartons stay available." };
                }
            case "startLoading":
                {
                    Permissions.Require(actor, "Loader", "DispatchSupervisor"); var s = await Get<Shipment>(Str(d, "shipmentId")); var trip = await Get<Trip>(s.TripId); Check(!s.LoadApproved && trip.State == "Open" && s.State is "Allocated" or "Loading", "Shipment is not open for loading.");
                    var station = Str(d, "station"); Check(station.Length is >= 2 and <= 80, "A station name is required."); var other = await db.LoadingSessions.Where(x => x.CompanyId == company && x.Station == station && x.Active).ToListAsync(); other.ForEach(x => x.Active = false); await db.SaveChangesAsync();
                    var session = new LoadingSession { CompanyId = company, UserId = actor.Id, ShipmentId = s.Id, TripId = s.TripId, Station = station }; db.LoadingSessions.Add(session); s.State = "Loading"; return new { id = session.Id, message = "Loading started. Only server-confirmed scans count." };
                }
            case "scan":
                {
                    Permissions.Require(actor, "Loader", "DispatchSupervisor"); var session = await Get<LoadingSession>(Str(d, "sessionId"));
                    Check(session.Active && session.ExpiresAt > DateTimeOffset.UtcNow && session.UserId == actor.Id && session.Station == Str(d, "station"), "Loading session expired, changed station or belongs to another operator.", 409);
                    Check(Str(d, "mode") == "live", "Stored/offline scanner replay requires supervised reconciliation.");
                    var s = await Get<Shipment>(session.ShipmentId); Check(!s.LoadApproved && s.State == "Loading", "Shipment is closed for loading."); var trip = await Get<Trip>(s.TripId); Check(trip.State == "Open" && trip.Id == session.TripId, "Trip context changed.");
                    Carton c; try { c = await ResolveQr(Str(d, "qr")); } catch (RuleException e) { return new { outcome = "Rejected", message = e.Message }; }
                    var allocation = await db.Allocations.SingleOrDefaultAsync(x => x.CompanyId == company && x.CartonId == c.Id && x.Active);
                    if (allocation == null || allocation.ShipmentId != s.Id || c.WarehouseId != s.WarehouseId) return new { outcome = "Rejected", message = "Carton is not allocated to this customer shipment." };
                    if (allocation.State == "Loaded") return new { outcome = "Duplicate", id = c.Id, message = "Already loaded. Totals unchanged." };
                    if (!c.Verified || !c.Attached || c.Held || c.State != "Reserved" || allocation.State != "Reserved") return new { outcome = "Rejected", message = "Carton is held, unverified, obsolete, retired or unavailable." };
                    allocation.State = "Loaded"; c.State = "Loaded"; return new { outcome = "Accepted", id = c.Id, lines = Json.Read<ContentLine[]>(c.Lines), message = "Carton and all its contents committed." };
                }
            case "unload":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "shipmentId")); Check(!s.LoadApproved && s.InvoiceJobId == null, "Approved or invoicing shipments require a controlled correction."); var c = await Get<Carton>(Str(d, "id")); var a = await db.Allocations.SingleOrDefaultAsync(x => x.CompanyId == company && x.ShipmentId == s.Id && x.CartonId == c.Id && x.Active); Check(a != null && a.State == "Loaded" && c.State == "Loaded", "Carton is not loaded on this shipment."); a!.State = "Reserved"; c.State = "Reserved"; return new { id = c.Id, message = "Unload recorded. All product quantities reversed operationally; no accounting movement." };
                }
            case "releaseShipment":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "id")); Check(!s.LoadApproved && s.InvoiceJobId == null, "Cannot release an approved/invoicing shipment."); var allocations = await db.Allocations.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync(); Check(allocations.All(x => x.State == "Reserved"), "Physically unload every loaded carton first."); foreach (var a in allocations) { a.Active = false; a.State = "Released"; (await Get<Carton>(a.CartonId)).State = "Available"; }
                    s.State = "Cancelled"; return new { message = "Reservations released. Original history preserved." };
                }
            case "approveLoad":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); Check(Flag(d, "physicalConfirmed"), "Physical load review is required."); var s = await Get<Shipment>(Str(d, "id")); var a = await db.Allocations.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync(); Check(a.Count > 0 && a.All(x => x.State == "Loaded"), "Every allocated identity and quantity must be loaded."); Check((await Get<Trip>(s.TripId)).State == "Open", "Trip is not open."); s.LoadApproved = true; s.LoadApprovedBy = actor.Id; s.State = "LoadApproved"; foreach (var session in await db.LoadingSessions.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync()) session.Active = false; return new { message = "Physical load approved. Billing review is next." };
                }
            case "saveBilling":
                {
                    Permissions.Require(actor, "Billing"); var input = Json.Read<BillDraft>(d); Check(input.Reason.Length >= 3, "Pricing/charge changes require a reason."); var s = await Get<Shipment>(input.ShipmentId); Check(s.LoadApproved, "Approve physical loading before billing."); Check(s.InvoiceJobId == null, "Posting job freezes the approved snapshot. Resolve it before corrections."); Check(s.BillingVersion == input.Version, "Billing revision changed. Reload.", 409);
                    var cartons = await ShipmentCartons(s.Id); var totals = cartons.SelectMany(c => Json.Read<ContentLine[]>(c.Lines)).GroupBy(l => new { l.Sku, l.Unit }).Select(g => new { g.Key.Sku, g.Key.Unit, Quantity = g.Sum(l => l.Quantity) }).ToArray();
                    Check(input.Rates.Length == totals.Length && input.Rates.Select(x => x.Sku).Distinct().Count() == input.Rates.Length, "Provide exactly one authorised rate for each SKU; differing units require accountant mapping.");
                    var lines = totals.Select(t => { var r = input.Rates.SingleOrDefault(x => x.Sku == t.Sku) ?? throw new RuleException($"Rate missing for {t.Sku}."); Check(r.Rate >= 0 && r.Rate <= 10000000 && r.DiscountPercent >= 0 && r.DiscountPercent <= 100, "Invalid rate or discount."); return new { t.Sku, t.Unit, t.Quantity, r.Rate, r.DiscountPercent, Net = decimal.Round(t.Quantity * r.Rate * (1 - r.DiscountPercent / 100m), 2, MidpointRounding.AwayFromZero) }; }).ToArray();
                    Check(input.Freight >= 0 && input.OtherCharges >= 0, "Charges must be non-negative."); s.BillingVersion++; s.State = "BillingDraft"; var bill = new Billing { CompanyId = company, ShipmentId = s.Id, Revision = s.BillingVersion, Snapshot = Json.Write(new { lines, input.Freight, input.OtherCharges, input.Terms, input.Reason, pricingSource = "Authorised manual entry", taxStatus = "Unresolved: no GST assumed", cartons = cartons.Select(c => new { c.Id, c.Revision, c.Lines }), customer = await Get<Customer>(s.CustomerId), s.Destination }), Total = lines.Sum(l => l.Net) + input.Freight + input.OtherCharges }; db.Billings.Add(bill); return new { id = bill.Id, total = bill.Total, revision = bill.Revision, message = "New billing revision saved. Earlier approval does not apply. Total excludes unresolved taxes." };
                }
            case "approveBilling":
                {
                    Permissions.Require(actor, "Billing"); var b = await Get<Billing>(Str(d, "id")); var s = await Get<Shipment>(b.ShipmentId); Check(s.LoadApproved && s.BillingVersion == b.Revision && s.InvoiceJobId == null, "Billing revision is no longer current or already posting."); Check(Flag(d, "physicalConfirmed"), "Review customer, contents, rates and charges before approving."); b.Approved = true; b.ApprovedBy = actor.Id; b.ApprovedAt = DateTimeOffset.UtcNow; s.State = "BillingApproved"; return new { message = "Billing draft approved. Tally mapping gates still apply." };
                }
            case "queueInvoice":
                {
                    Permissions.Require(actor, "Billing"); var s = await Get<Shipment>(Str(d, "id")); Check(s.InvoiceJobId == null, "A posting job already exists for this shipment."); var b = await db.Billings.SingleOrDefaultAsync(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Revision == s.BillingVersion); Check(s.LoadApproved && b is { Approved: true }, "Approve current billing and load first.");
                    // No production Create path is enabled until an accountant-approved contract, reliable marker and readback
                    // are validated on the real installation. A durable blocked job is honest and safe to inspect.
                    var job = new PostingJob { CompanyId = company, ShipmentId = s.Id, BillingId = b!.Id, PayloadHash = Hash(b.Snapshot) }; db.Jobs.Add(job); s.InvoiceJobId = job.Id; s.State = "InvoiceBlocked"; return new { id = job.Id, state = job.State, message = job.Detail };
                }
            case "saveMapping":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d); var m = await db.Mappings.SingleAsync(x => x.CompanyId == company); m.ExpectedCompany = Str(d, "expectedCompany"); m.TallyVersion = Str(d, "tallyVersion"); m.SalesLedger = Str(d, "salesLedger"); m.VoucherType = Str(d, "voucherType"); m.Notes = Str(d, "notes"); m.StatutoryRequired = Flag(d, "statutoryRequired"); m.ContractValidated = false; m.Pattern = "Unvalidated"; return new { message = "Mapping draft saved. Posting remains blocked until installation-specific contract verification is implemented and passed." };
                }
            case "pairConnector":
                {
                    Permissions.Require(actor); var expected = Str(d, "expectedCompany"); Check(expected.Length >= 3, "Exact isolated test-company name required."); var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); var c = new Connector { CompanyId = company, Name = Str(d, "name"), SecretHash = Hash(secret), ExpectedCompany = expected }; db.Connectors.Add(c); Audit(type, c.Id, new { c.Name, c.ExpectedCompany, c.Environment }); return new { id = c.Id, secret, message = "Copy this credential to the Tally PC. It is scoped to this exact test company. Revoke and re-pair if lost." };
                }
            case "revokeConnector": { Permissions.Require(actor); RequireReason(d); (await Get<Connector>(Str(d, "id"))).Revoked = true; return new { message = "Connector credential revoked." }; }
            case "createUser":
                {
                    Permissions.Require(actor); var roles = Json.Read<string[]>(d.GetProperty("roles")); Check(roles.Length > 0 && roles.All(Permissions.Roles.Contains), "Choose valid roles."); var password = Str(d, "password"); Check(password.Length >= 12, "Use at least 12 characters."); var email = Str(d, "email").ToLowerInvariant(); Check(System.Net.Mail.MailAddress.TryCreate(email, out _), "Valid email required."); var u = new User { CompanyId = company, Email = email, Name = Str(d, "name"), Roles = roles }; u.PasswordHash = new Microsoft.AspNetCore.Identity.PasswordHasher<User>().HashPassword(u, password); db.Users.Add(u); Audit(type, u.Id, new { u.Email, u.Roles }); return new { id = u.Id, message = "User created." };
                }
            case "depart":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); Check(Flag(d, "physicalConfirmed"), "Confirm vehicle and physical load review."); var t = await Get<Trip>(Str(d, "id")); Check(t.State == "Open", "Trip is not open."); var shipments = await db.Shipments.Where(x => x.CompanyId == company && x.TripId == t.Id && x.State != "Cancelled").ToListAsync(); Check(shipments.Count > 0, "Trip has no shipments.");
                    foreach (var s in shipments) { Check(s.InvoiceJobId != null, "Each shipment requires a verified invoice."); var job = await Get<PostingJob>(s.InvoiceJobId!); Check(job.State == "Confirmed" && job.VoucherReference != null, "Every shipment needs a Tally invoice confirmed through readback."); var documents = Json.Read<Dictionary<string, string>>(s.Documents); Check(documents.GetValueOrDefault("print") == "OperatorConfirmed", "Confirm the existing invoice was printed."); var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == company); if (mapping.StatutoryRequired) Check(!string.IsNullOrEmpty(documents.GetValueOrDefault("statutoryReference")), "Required statutory references unresolved."); foreach (var a in await db.Allocations.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync()) { Check(a.State == "Loaded", "Allocation mismatch."); a.State = "Departed"; (await Get<Carton>(a.CartonId)).State = "Departed"; } s.State = "Departed"; }
                    t.State = "Departed"; t.DepartedAt = DateTimeOffset.UtcNow; return new { message = "Departure recorded. No additional accounting stock movement created." };
                }
            case "recordDocuments":
                {
                    Permissions.Require(actor, "Billing", "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "id")); Check(s.State != "Departed" && s.InvoiceJobId != null, "A confirmed invoice is required before driver documents."); var job = await Get<PostingJob>(s.InvoiceJobId!); Check(job.State == "Confirmed" && !string.IsNullOrEmpty(job.VoucherReference), "Do not print an unconfirmed invoice."); var print = Str(d, "print"); Check(new[] { "Prepared", "Submitted", "Failed", "Unknown", "OperatorConfirmed" }.Contains(print), "Invalid print status."); s.Documents = Json.Write(new { print, statutoryReference = Str(d, "statutoryReference"), confirmedVoucher = job.VoucherReference, operatorId = actor.Id, at = DateTimeOffset.UtcNow }); return new { message = "Existing confirmed invoice document status recorded. No new sale or stock movement created." };
                }
            case "recordReturn":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "shipmentId")); Check(s.State == "Departed", "Use unload for pre-departure corrections."); var c = await Get<Carton>(Str(d, "id")); Check(await db.Allocations.AnyAsync(x => x.CompanyId == company && x.ShipmentId == s.Id && x.CartonId == c.Id && x.State == "Departed"), "Carton does not belong to the original departure."); var lines = await Normalize(Json.Read<ContentLine[]>(d.GetProperty("lines"))); var prior = await db.Returns.Where(x => x.CompanyId == company && x.CartonId == c.Id).ToListAsync(); var original = Json.Read<ContentLine[]>(c.Lines); foreach (var l in lines) { var available = original.Where(o => o.Sku == l.Sku && o.Unit == l.Unit && o.Batch == l.Batch && o.Godown == l.Godown).Sum(o => o.Quantity) - prior.SelectMany(p => Json.Read<ContentLine[]>(p.Lines)).Where(o => o.Sku == l.Sku && o.Unit == l.Unit && o.Batch == l.Batch && o.Godown == l.Godown).Sum(o => o.Quantity); Check(l.Quantity <= available, "Return exceeds original unreturned quantities."); }
                    var ret = new ReturnRecord { CompanyId = company, ShipmentId = s.Id, CartonId = c.Id, Lines = Json.Write(lines), Reason = Str(d, "reason"), Condition = Str(d, "condition") }; db.Returns.Add(ret); return new { id = ret.Id, message = "Return quarantined. Original identity stays departed; stock receipt and credit require separate accountant review." };
                }
            case "returnDisposition":
                {
                    Permissions.Require(actor, "PackingSupervisor"); RequireReason(d); var ret = await Get<ReturnRecord>(Str(d, "id")); var disposition = Str(d, "disposition"); Check(new[] { "Quarantine", "Disposal", "AwaitingAccountingRestock" }.Contains(disposition), "Unsupported disposition. Accounting review is required before restock/replacement identity."); ret.State = disposition; return new { message = "QC disposition saved. No automatic stock or accounting movement." };
                }
            default: throw new RuleException("Unknown operation.", 404);
        }
    }
    async Task<List<Carton>> Selected(JsonElement d)
    {
        var ids = Ids(d); Check(ids.Length is > 0 and <= 1000 && ids.Distinct().Count() == ids.Length, "Select 1–1,000 distinct cartons."); var rows = await db.Cartons.Where(x => x.CompanyId == company && ids.Contains(x.Id)).ToListAsync(); Check(rows.Count == ids.Length, "Carton missing or belongs to another company."); return rows;
    }
    async Task<Carton> ResolveQr(string qr)
    {
        Check(qr.Length <= 160, "QR payload too long."); var parts = qr.Split('|'); Check(parts.Length == 4 && parts[0] == "K1" && parts[1] == company && int.TryParse(parts[3], out _), "Invalid or wrong-company carton QR. Product barcodes cannot identify cartons."); var c = await Get<Carton>(parts[2]); Check(c.Revision.ToString() == parts[3], "Obsolete label revision. Scan the current attached label."); return c;
    }
    async Task ValidateGroups(PackedGroup[] groups)
    {
        Check(groups.Length is > 0 and <= 1000, "Provide 1–1,000 packing groups."); Check(groups.Select(g => g.Marking).Distinct().Count() == groups.Length, "Group markings must be unique."); Check(groups.Sum(g => (long)g.Count) <= 10000, "Approval is bounded to 10,000 cartons per manifest.");
        foreach (var g in groups) { Check(g.Count is > 0 and <= 10000 && g.Marking.Length is >= 1 and <= 80, "Positive carton counts and physical markings are required."); await Normalize(g.Lines); }
    }
    async Task<ContentLine[]> Normalize(ContentLine[] lines)
    {
        Check(lines.Length is > 0 and <= 100, "Provide 1–100 contents per carton."); Check(lines.Select(l => l.Sku + "|" + l.Unit + "|" + l.Batch + "|" + l.Godown).Distinct().Count() == lines.Length, "Combine duplicate SKU/unit/batch/godown content lines explicitly.");
        var normalized = new List<ContentLine>(); foreach (var l in lines)
        {
            Check(l.Quantity > 0 && l.Quantity <= 100000000 && decimal.Round(l.Quantity, 6) == l.Quantity, "Quantities must be positive with at most six decimal places."); var product = await db.Products.SingleOrDefaultAsync(x => x.CompanyId == company && x.Sku == l.Sku); Check(product != null, $"Unknown exact SKU '{l.Sku}'."); decimal factor = 1; if (l.Unit != product!.Unit) { var conversion = await db.Conversions.SingleOrDefaultAsync(x => x.CompanyId == company && x.ProductId == product.Id && x.FromUnit == l.Unit && x.BaseUnit == product.Unit); Check(conversion != null && conversion.Factor > 0, $"Missing validated conversion: {l.Sku} / {l.Unit}."); factor = conversion!.Factor; }
            Check(l.Batch == null && l.Godown == null, "Batch/godown content capture requires validated Tally mapping; no defaults are invented."); normalized.Add(l with { BaseQuantity = l.Quantity * factor, BaseUnit = product.Unit });
        }
        return normalized.ToArray();
    }
    static Dictionary<string, decimal> Totals(IEnumerable<Carton> cartons) => cartons.SelectMany(c => Json.Read<ContentLine[]>(c.Lines)).GroupBy(l => l.Sku + "|" + l.Unit + "|" + l.Batch + "|" + l.Godown).ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity));
    async Task<List<Carton>> ShipmentCartons(string id) => await db.Cartons.Where(c => c.CompanyId == company && db.Allocations.Any(a => a.CompanyId == company && a.ShipmentId == id && a.CartonId == c.Id && a.Active)).ToListAsync();
}
