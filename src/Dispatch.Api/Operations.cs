using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public record Command(string RequestId, string Type, JsonElement Data);
public record GroupDraft(string Name, string WarehouseId, string? CustomerId, string Notes, PackedGroup[] Groups, string? Id = null, int Version = 0, string? OrderId = null);
public record RateLine(string Sku, decimal Rate, decimal DiscountPercent);
public record LabelCheck(string Id, int Revision);
public record BillDraft(string ShipmentId, RateLine[] Rates, decimal Freight, decimal OtherCharges, string Reason, string Terms, int Version);
public static class Permissions
{
    public static readonly string[] Roles = ["Admin", "PackingClerk", "PackingSupervisor", "Loader", "DispatchSupervisor", "Billing", "MD"];
    public static void Require(User u, params string[] roles) { if (!u.Roles.Contains("Admin") && !u.Roles.Intersect(roles).Any()) throw new RuleException("Your role cannot perform this action.", 403); }
}
public sealed partial class Operations(DispatchDb db, DeploymentScope deployment)
{
    User actor = null!;
    string company = "";
    static string NewId(string prefix) => prefix + Guid.NewGuid().ToString("N")[..20].ToUpperInvariant();
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    static string Str(JsonElement d, string key) => d.TryGetProperty(key, out var v) ? v.GetString()?.Trim() ?? "" : "";
    static bool Flag(JsonElement d, string key) => d.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True;
    static string[] Ids(JsonElement d) => Json.Read<string[]>(d.GetProperty("ids"));
    static bool IsKnownLegacyTrial(Shipment shipment, DispatchOrder? order, Customer customer) =>
        string.Equals(shipment.Id, "SH-DF278E58C71F4304BEDB", StringComparison.OrdinalIgnoreCase) ||
        (order?.Reference == "PO-1234-TEST" && customer.Name == "TEST - Bengaluru Machine Works");
    static void Check(bool condition, string error, int status = 400) { if (!condition) throw new RuleException(error, status); }
    async Task EnsureOrderOpenForShipment(Shipment shipment)
    {
        if (shipment.OrderId is not { Length: > 0 } orderId) return;
        var order = await db.Orders.SingleOrDefaultAsync(x => x.CompanyId == company && x.Id == orderId);
        Check(order?.State == "Open", $"PO {order?.Reference ?? orderId} was cancelled. No new dispatch or billing work is allowed.", 409);
    }
    async Task EnsureCartonsOrderOpen(IEnumerable<Carton> cartons)
    {
        var manifestIds = cartons.Select(x => x.ManifestId).Distinct().ToArray();
        var orderIds = await db.Manifests.Where(x => x.CompanyId == company && manifestIds.Contains(x.Id) && x.OrderId != null).Select(x => x.OrderId!).Distinct().ToArrayAsync();
        foreach (var orderId in orderIds)
        {
            var order = await db.Orders.SingleOrDefaultAsync(x => x.CompanyId == company && x.Id == orderId);
            Check(order?.State == "Open", $"PO {order?.Reference ?? orderId} was cancelled. No new packing or label work is allowed.", 409);
        }
    }
    public async Task<T> Get<T>(string id) where T : Scoped
    {
        var record = await db.Set<T>().SingleOrDefaultAsync(x => x.Id == id && x.CompanyId == company) ?? throw new RuleException("Record unavailable in your company.", 404);
        await CheckWorkflow(record); return record;
    }
    void RequireReason(JsonElement d) => Check(Str(d, "reason").Length >= 3, "A meaningful reason is required.");
    void Audit(string action, string entity, object data) { var shared = new[] { "saveProduct", "saveCustomer", "saveMapping", "validateTallyContract", "pairConnector", "revokeConnector", "createUser", "productMapping", "customerMapping", "importTallyMasters" }.Contains(action); var e = new AuditEvent { CompanyId = company, Workflow = shared ? null : workflow, ActorId = actor.Id, Action = action, EntityId = entity, Data = Json.Write(data) }; db.Audit.Add(e); db.Outbox.Add(new OutboxEvent { CompanyId = company, AuditId = e.Id }); }
    public async Task<object> Execute(User user, Command cmd)
    {
        actor = user; company = user.CompanyId;
        Check(deployment.Site == null || company == deployment.Site.CompanyId, "Account unavailable on this company's website.", 401);
        workflow = deployment.Site?.Resolve(Str(cmd.Data, "workflow")) ?? Workflows.Parse(Str(cmd.Data, "workflow"));
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
            case "createOrder": return await CreateOrder(d);
            case "deleteOrder": return await DeleteOrder(d);
            case "cancelOrder": return await CancelOrder(d);
            case "deleteDemoOrder": return await DeleteDemoOrder(d);
            case "prepareOrderShipment":
                {
                    Permissions.Require(actor, "PackingSupervisor", "DispatchSupervisor");
                    var order = await Get<DispatchOrder>(Str(d, "id"));
                    var shipmentId = await PrepareOrderShipment(order);
                    Check(shipmentId != null, "Approve and label all boxes for this order first. They will then be prepared for scanning automatically.", 409);
                    return new { shipmentId, message = "Boxes are ready. The customer shipment is prepared for scanning; vehicle details are not required." };
                }
            case "deleteManifest":
                {
                    Permissions.Require(actor, "PackingSupervisor"); RequireReason(d); Check(Flag(d, "confirmed"), "Confirm deleting this packing list.");
                    var m = await Get<Manifest>(Str(d, "id")); Check(d.TryGetProperty("version", out var version) && version.TryGetInt32(out var expectedVersion) && expectedVersion == m.Version, "This list changed. Refresh before deleting.", 409);
                    var cartons = await db.Cartons.Where(c => c.CompanyId == company && c.ManifestId == m.Id).ToListAsync(); var ids = cartons.Select(c => c.Id).ToArray();
                    Check(cartons.All(c => c.State == "Available") && !await db.Allocations.AnyAsync(a => a.CompanyId == company && ids.Contains(a.CartonId)) && !await db.Returns.AnyAsync(r => r.CompanyId == company && ids.Contains(r.CartonId)), "Only unused packing lists can be deleted. Release reservations first; dispatched history must be kept.");
                    Audit("deletedPackingContents", m.Id, new { manifest = m, cartons, reason = Str(d, "reason") });
                    db.Cartons.RemoveRange(cartons); db.Manifests.Remove(m); return new { message = "Packing list deleted. Its old carton labels are no longer valid." };
                }
            case "deleteShipment":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); Check(Flag(d, "confirmed"), "Confirm deleting this shipment.");
                    var s = await Get<Shipment>(Str(d, "id")); var allocations = await db.Allocations.Where(a => a.CompanyId == company && a.ShipmentId == s.Id).ToListAsync();
                    Check(!s.LoadApproved && s.InvoiceJobId == null && s.State != "Departed" && allocations.All(a => a.State is "Reserved" or "Released") && !await db.Jobs.AnyAsync(j => j.CompanyId == company && j.ShipmentId == s.Id) && !await db.Returns.AnyAsync(r => r.CompanyId == company && r.ShipmentId == s.Id), "Unload all cartons first. Approved, invoiced and dispatched shipments cannot be deleted.");
                    foreach (var a in allocations.Where(a => a.Active)) (await Get<Carton>(a.CartonId)).State = "Available";
                    Audit("deletedShipmentContents", s.Id, new { shipment = s, allocations, reason = Str(d, "reason") });
                    db.LoadingSessions.RemoveRange(await db.LoadingSessions.Where(x => x.CompanyId == company && x.ShipmentId == s.Id).ToListAsync());
                    db.Billings.RemoveRange(await db.Billings.Where(x => x.CompanyId == company && x.ShipmentId == s.Id).ToListAsync()); db.Allocations.RemoveRange(allocations); db.Shipments.Remove(s);
                    return new { message = "Shipment deleted. Reserved cartons are available again." };
                }
            case "deleteTrip":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); Check(Flag(d, "confirmed"), "Confirm deleting this trip.");
                    var t = await Get<Trip>(Str(d, "id")); Check(t.State == "Open" && !await db.Shipments.AnyAsync(s => s.CompanyId == company && s.TripId == t.Id), "Only an empty, undeparted trip can be deleted. Delete its unused shipments first.");
                    db.LoadingSessions.RemoveRange(await db.LoadingSessions.Where(x => x.CompanyId == company && x.TripId == t.Id).ToListAsync()); Audit("deletedTripContents", t.Id, new { trip = t, reason = Str(d, "reason") }); db.Trips.Remove(t);
                    return new { message = "Vehicle trip deleted." };
                }
            case "saveProduct":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d); var sku = Str(d, "sku"); Check(sku.Length is >= 1 and <= 50 && Str(d, "name").Length >= 2 && Str(d, "unit").Length >= 1, "Exact SKU, name and base unit required."); var p = await db.Products.SingleOrDefaultAsync(x => x.CompanyId == company && x.Sku == sku); if (p == null) { p = new Product { CompanyId = company, Sku = sku }; db.Products.Add(p); } else Check(p.Unit == Str(d, "unit") || !await db.Cartons.AnyAsync(c => c.CompanyId == company && c.Lines.Contains(sku)), "Cannot change a unit already captured in carton snapshots."); var before = new { p.Name, p.Unit, p.TallyId, p.TallyName }; p.Name = Str(d, "name"); p.Unit = Str(d, "unit"); p.TallyId = Str(d, "tallyId") is { Length: > 0 } native ? native : null; p.TallyName = Str(d, "tallyName") is { Length: > 0 } name ? name : null; Audit("productMapping", p.Id, new { before, sku, reason = Str(d, "reason") }); return new { id = p.Id, message = "Operational product mapping saved. No Tally master was created." };
                }
            case "saveCustomer":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d); Check(Str(d, "name").Length >= 2 && Str(d, "address").Length >= 3, "Customer name and delivery address required."); var id = Str(d, "id"); var c = id.Length > 0 ? await Get<Customer>(id) : new Customer { CompanyId = company }; if (id.Length == 0) db.Customers.Add(c); var before = new { c.Name, c.Address, c.TallyId, c.GstIn }; c.Name = Str(d, "name"); c.Address = Str(d, "address"); c.TallyId = Str(d, "tallyId") is { Length: > 0 } native ? native : null; c.GstIn = Str(d, "gstIn") is { Length: > 0 } gst ? gst : null; Audit("customerMapping", c.Id, new { before, reason = Str(d, "reason") }); return new { id = c.Id, message = "Customer mapping saved. Validate the accountant's actual ledger." };
                }
            case "importTallyMasters":
                {
                    Permissions.Require(actor, "Billing");
                    Check(deployment.Site?.Slug == "electro", "Tally master import is enabled only on Electro Group's site.", 403);
                    var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == company);
                    var connector = await db.Connectors.Where(x => x.CompanyId == company && !x.Revoked && x.Environment == "Production" && x.ExpectedCompany == mapping.ExpectedCompany)
                        .OrderByDescending(x => x.MastersSyncedAt).FirstOrDefaultAsync();
                    Check(connector != null && connector.MastersSyncedAt.HasValue && connector.MastersSyncedAt.Value >= DateTimeOffset.UtcNow.AddMinutes(-5), "No fresh Tally master list is available. Keep Tally and the paired connector running, then refresh.", 409);
                    var activeConnector = connector!;
                    var diagnostics = Json.Read<ConnectorDiagnostics>(activeConnector.Diagnostics);
                    Check(diagnostics.TallyReachable, "Tally is not currently reachable. Check the Tally PC connection first.", 409);
                    var snapshot = Json.Read<TallyMasterSnapshot>(activeConnector.MastersSnapshot);
                    Check(snapshot.Company == activeConnector.ExpectedCompany && snapshot.Environment == "Production", "The staged master list does not match this exact Tally company.", 409);
                    Check(snapshot.Items.Length > 0 && snapshot.Ledgers.Length > 0, "Tally returned no stock items or ledgers. Nothing was imported.", 409);
                    var totals = await TallyMasterSync.Apply(db, company, snapshot);
                    mapping.SyncedAt = DateTimeOffset.UtcNow;
                    Audit("importTallyMasters", activeConnector.Id, new { company = snapshot.Company, totals, sourceAt = activeConnector.MastersSyncedAt });
                    return new { message = "Tally stock items and customer ledgers were synchronized. Archived unused demo stock is kept out of future dispatch choices; Tally IDs keep active masters linked to the same dispatch records.", totals, importedAt = DateTimeOffset.UtcNow };
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
                    await ValidateGroups(input.Groups);
                    DispatchOrder? order = null;
                    if (workflow == Workflows.OrderFirst)
                    {
                        Check(!string.IsNullOrEmpty(input.OrderId), "Record and choose the customer order before packing.");
                        order = await Get<DispatchOrder>(input.OrderId!);
                        Check(order.CustomerId == input.CustomerId && order.WarehouseId == input.WarehouseId, "Packing customer and warehouse must match the order.");
                        await ValidateOrderPacking(order, input.Groups, input.Id);
                    }
                    else Check(string.IsNullOrEmpty(input.OrderId) && (!d.TryGetProperty("workflow", out _) || input.CustomerId == null), "Pack-before-order cartons must start as general stock. Assign the customer when the order arrives.");
                    Manifest m;
                    if (input.Id != null) { m = await Get<Manifest>(input.Id); Check(m.State == "Draft", "Approved manifests are immutable."); Check(m.Version == input.Version, "Another operator changed this draft. Reload before saving.", 409); m.Version++; }
                    else { m = new Manifest { CompanyId = company, Workflow = workflow, Id = NewId("PK-") }; db.Manifests.Add(m); }
                    m.OrderId = order?.Id;
                    m.Name = input.Name; m.WarehouseId = input.WarehouseId; m.CustomerId = input.CustomerId; m.Notes = input.Notes; m.Groups = Json.Write(input.Groups);
                    return new { id = m.Id, version = m.Version, message = "Draft saved. A supervisor must check the packed cartons before approval." };
                }
            case "approveManifest":
                {
                    Permissions.Require(actor, "PackingSupervisor"); Check(Flag(d, "physicalConfirmed"), "Confirm the physical group markings and contents.");
                    var m = await Get<Manifest>(Str(d, "id")); if (m.State == "Approved") return new { id = m.Id, message = "This packing list is already approved. No extra cartons were created." };
                    Check(m.State == "Draft", "Manifest cannot be approved in this state.");
                    var groups = Json.Read<PackedGroup[]>(m.Groups); await ValidateGroups(groups);
                    if (m.OrderId != null) await ValidateOrderPacking(await Get<DispatchOrder>(m.OrderId), groups, m.Id);
                    foreach (var group in groups) for (var i = 0; i < group.Count; i++) db.Cartons.Add(new Carton { Id = NewId("CT-"), CompanyId = company, ManifestId = m.Id, WarehouseId = m.WarehouseId, CustomerId = m.CustomerId, Marking = group.Marking, Lines = Json.Write(await Normalize(group.Lines)) });
                    m.State = "Approved"; m.ApprovedBy = actor.Id; m.ApprovedAt = DateTimeOffset.UtcNow; m.Version++;
                    return new { id = m.Id, count = groups.Sum(g => g.Count), message = "Cartons created. Print and attach labels, then ask a supervisor to confirm labels and contents without scanning." };
                }
            case "createLabels":
                {
                    Permissions.Require(actor, "PackingClerk", "PackingSupervisor"); RequireReason(d); var cartons = await Selected(d);
                    await EnsureCartonsOrderOpen(cartons);
                    Check(cartons.All(c => c.State is "Available" or "Reserved"), "Retired, loaded and dispatched labels cannot be reissued through the packing screen.");
                    var label = new LabelJob { CompanyId = company, Workflow = workflow, OperatorId = actor.Id, Reason = Str(d, "reason"), CartonSnapshots = Json.Write(cartons.Select(c => new { c.Id, c.Revision, c.Marking, c.Lines, c.CompanyId, qr = CartonCodes.Encode(c.Id, c.Revision, company) })) }; db.Labels.Add(label);
                    return new { id = label.Id, cartons, message = "Labels are ready. Print them and attach them to the matching cartons." };
                }
            case "labelStatus":
                {
                    Permissions.Require(actor, "PackingClerk", "PackingSupervisor"); var job = await Get<LabelJob>(Str(d, "id")); var state = Str(d, "state");
                    Check(new[] { "Submitted", "Failed", "Unknown", "OperatorConfirmed" }.Contains(state), "Invalid print state."); RequireReason(d); job.State = state; return new { id = job.Id, message = "Print status saved. The cartons still need to be checked." };
                }
            case "attachLabels":
                {
                    Permissions.Require(actor, "PackingSupervisor"); Check(Flag(d, "physicalConfirmed") && Flag(d, "contentsConfirmed"), "A supervisor must confirm both matching labels and actual carton contents. Reload Labels if you are using the older screen.");
                    var cartons = await Selected(d); await EnsureCartonsOrderOpen(cartons); Check(d.TryGetProperty("revisions", out var revisionInput) && revisionInput.ValueKind == JsonValueKind.Array, "Reload Labels and confirm the current carton versions.");
                    var expected = Json.Read<LabelCheck[]>(revisionInput); Check(expected.Length == cartons.Count && expected.Select(x => x.Id).Distinct().Count() == cartons.Count, "Reload Labels and confirm the current carton versions.", 409);
                    var versions = expected.ToDictionary(x => x.Id, x => x.Revision); Check(cartons.All(c => versions.TryGetValue(c.Id, out var revision) && revision == c.Revision), "A carton changed after it was shown. Reload Labels and check the updated contents and label.", 409);
                    foreach (var c in cartons) { Check(c.State == "Available" && !c.Held, "Only available, unheld cartons may be checked."); c.Attached = true; c.Verified = true; c.VerifiedBy = actor.Id; c.VerifiedAt = DateTimeOffset.UtcNow; }
                    var shipmentIds = new List<string>();
                    if (workflow == Workflows.OrderFirst)
                    {
                        var manifestIds = cartons.Select(c => c.ManifestId).Distinct().ToArray();
                        var orderIds = await db.Manifests.Where(m => m.CompanyId == company && manifestIds.Contains(m.Id) && m.OrderId != null).Select(m => m.OrderId!).Distinct().ToArrayAsync();
                        foreach (var orderId in orderIds)
                        {
                            var order = await db.Orders.SingleAsync(o => o.CompanyId == company && o.Id == orderId);
                            var shipmentId = await PrepareOrderShipment(order);
                            if (shipmentId != null) shipmentIds.Add(shipmentId);
                        }
                    }
                    var message = shipmentIds.Count > 0
                        ? $"Labels confirmed for {cartons.Count} boxes. The order shipment is ready; scan each box as it is loaded. No vehicle details are needed."
                        : $"Labels and contents confirmed for {cartons.Count} boxes. Once all ordered boxes are approved and labeled, the shipment will be prepared automatically.";
                    return new { message, shipmentIds };
                }
            case "verifyCarton":
                {
                    throw new RuleException("The separate carton-check scan has been removed. A supervisor confirms labels and contents without scanning. Scan once in Labels > Scan for dispatch while loading.");
                }
            case "holdCarton":
                {
                    Permissions.Require(actor, "PackingSupervisor", "DispatchSupervisor"); RequireReason(d); var c = await Get<Carton>(Str(d, "id")); Check(c.State == "Available", "Unload and release allocations before changing a hold."); c.Held = Flag(d, "held"); return new { id = c.Id, message = c.Held ? "Carton held. Loading blocked." : "Hold cleared." };
                }
            case "reviseCarton":
                {
                    Permissions.Require(actor, "PackingSupervisor"); RequireReason(d); var c = await Get<Carton>(Str(d, "id")); await EnsureCartonsOrderOpen([c]); Check(c.State == "Available", "Only unloaded, unallocated cartons can be revised."); var lines = Json.Read<ContentLine[]>(d.GetProperty("lines")); var previous = new { c.Revision, c.Lines }; c.Lines = Json.Write(await Normalize(lines)); c.Revision++; c.Verified = false; c.Attached = false; c.VerifiedAt = null; c.VerifiedBy = null; Audit("contentRevision", c.Id, new { previous, next = c.Lines, reason = Str(d, "reason") }); return new { id = c.Id, revision = c.Revision, message = "Print a new label and check the carton again. The old QR can no longer be used." };
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
                    Permissions.Require(actor, "DispatchSupervisor"); Check(Str(d, "vehicle").Length >= 4 && Str(d, "driver").Length >= 2, "Vehicle and driver are required."); var trip = new Trip { Id = NewId("TR-"), CompanyId = company, Workflow = workflow, Vehicle = Str(d, "vehicle"), Driver = Str(d, "driver"), Transporter = Str(d, "transporter") }; db.Trips.Add(trip); return new { id = trip.Id, message = "Vehicle trip created." };
                }
            case "updateTrip":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var t = await Get<Trip>(Str(d, "id")); Check(t.State == "Open", "Departed trip details are immutable."); Check(Str(d, "vehicle").Length >= 4 && Str(d, "driver").Length >= 2, "Vehicle and driver required."); var before = new { t.Vehicle, t.Driver }; t.Vehicle = Str(d, "vehicle"); t.Driver = Str(d, "driver"); Audit("vehicleCorrection", t.Id, new { before, after = new { t.Vehicle, t.Driver }, reason = Str(d, "reason") }); return new { message = "Vehicle details updated with history." };
                }
            case "updateShipmentDestination":
                {
                    Permissions.Require(actor, "DispatchSupervisor", "Billing"); RequireReason(d);
                    var shipment = await Get<Shipment>(Str(d, "id"));
                    await EnsureOrderOpenForShipment(shipment);
                    Check(shipment.State != "Departed" && shipment.InvoiceJobId == null, "A departed or invoiced shipment cannot have its delivery destination changed.", 409);
                    Check((await Get<Trip>(shipment.TripId)).State == "Open", "The vehicle trip is closed; destination details are immutable.", 409);
                    var destination = Str(d, "destination");
                    Check(destination.Length is >= 3 and <= 300, "Enter the complete delivery destination, including state.");
                    var customer = await Get<Customer>(shipment.CustomerId);
                    Check(!string.IsNullOrWhiteSpace(customer.TallyId), "The customer is not linked to an exact Tally ledger.", 409);
                    var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == company);
                    var connector = await db.Connectors.Where(x => x.CompanyId == company && !x.Revoked && x.Environment == "Production" && x.ExpectedCompany == mapping.ExpectedCompany && x.LastSeen > DateTimeOffset.UtcNow.AddMinutes(-4)).OrderByDescending(x => x.LastSeen).FirstOrDefaultAsync();
                    Check(connector != null, "The Tally PC must be online to confirm the delivery state.", 409);
                    var catalog = Json.Read<TallyMasterSnapshot>(connector!.MastersSnapshot);
                    var party = catalog.Ledgers.SingleOrDefault(x => x.NativeId == customer.TallyId && x.Group == "Sundry Debtors");
                    Check(party != null && !string.IsNullOrWhiteSpace(party.StateName), "The exact Tally customer state is missing. Refresh Tally masters first.", 409);
                    var stateName = party!.StateName!.Trim();
                    Check(destination.Contains(stateName, StringComparison.OrdinalIgnoreCase), $"Add the Tally customer state '{stateName}' to the delivery destination. The bill must be approved again after this change.", 409);
                    var before = shipment.Destination;
                    shipment.Destination = destination;
                    if (shipment.OrderId is { Length: > 0 } orderId)
                    {
                        var order = await db.Orders.SingleOrDefaultAsync(x => x.CompanyId == company && x.Id == orderId);
                        if (order != null) order.Destination = destination;
                    }
                    var bill = await db.Billings.SingleOrDefaultAsync(x => x.CompanyId == company && x.ShipmentId == shipment.Id && x.Revision == shipment.BillingVersion);
                    if (bill is { Approved: true }) { bill.Approved = false; bill.ApprovedBy = null; bill.ApprovedAt = null; shipment.State = "BillingDraft"; }
                    Audit("shipmentDestinationCorrection", shipment.Id, new { before, after = destination, customerState = stateName, reason = Str(d, "reason"), reapprovalRequired = bill != null });
                    return new { message = bill?.Approved == false ? "Delivery address saved. Review and approve the bill again before sending it to Tally." : "Delivery address saved and checked against the Tally customer state." };
                }
            case "autofillShipmentAddressFromTally":
                {
                    Permissions.Require(actor, "DispatchSupervisor", "Billing");
                    var shipment = await Get<Shipment>(Str(d, "id"));
                    await EnsureOrderOpenForShipment(shipment);
                    Check(shipment.State != "Departed" && shipment.InvoiceJobId == null, "A departed or invoiced shipment cannot have its delivery address changed.", 409);
                    Check((await Get<Trip>(shipment.TripId)).State == "Open", "The vehicle trip is closed; destination details are immutable.", 409);
                    var order = shipment.OrderId is { Length: > 0 } orderId ? await db.Orders.SingleOrDefaultAsync(x => x.CompanyId == company && x.Id == orderId) : null;
                    var customer = await Get<Customer>(shipment.CustomerId);
                    Check(!string.IsNullOrWhiteSpace(customer.TallyId), "The customer is not linked to an exact Tally ledger.", 409);
                    var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == company);
                    var connector = await db.Connectors.Where(x => x.CompanyId == company && !x.Revoked && x.Environment == "Production" && x.ExpectedCompany == mapping.ExpectedCompany && x.LastSeen > DateTimeOffset.UtcNow.AddMinutes(-4)).OrderByDescending(x => x.LastSeen).FirstOrDefaultAsync();
                    Check(connector != null, "The Tally PC must be online to fetch the customer address.", 409);
                    var catalog = Json.Read<TallyMasterSnapshot>(connector!.MastersSnapshot);
                    var party = catalog.Ledgers.SingleOrDefault(x => x.NativeId == customer.TallyId && x.Group == "Sundry Debtors");
                    Check(party != null && !string.IsNullOrWhiteSpace(party.StateName), "Tally did not return a state for this customer. Check the customer's state in Tally and sync again.", 409);
                    var address = string.IsNullOrWhiteSpace(party!.Address) ? shipment.Destination.Trim() : party.Address.Trim();
                    var stateName = party.StateName!.Trim();
                    if (!address.Contains(stateName, StringComparison.OrdinalIgnoreCase)) address += ", " + stateName;
                    Check(address.Length <= 300, "The Tally customer address is too long to use as a delivery destination.");
                    var before = shipment.Destination;
                    shipment.Destination = address;
                    if (order != null) order.Destination = address;
                    var bill = await db.Billings.SingleOrDefaultAsync(x => x.CompanyId == company && x.ShipmentId == shipment.Id && x.Revision == shipment.BillingVersion);
                    var wasApproved = bill?.Approved == true;
                    if (wasApproved) { bill!.Approved = false; bill.ApprovedBy = null; bill.ApprovedAt = null; shipment.State = "BillingDraft"; }
                    Audit("tallyAddressAppliedToShipment", shipment.Id, new { before, after = address, stateName, reason = "Fetched exact customer address and state from the connected Tally ledger", reapprovalRequired = wasApproved });
                    return new { message = wasApproved ? $"Tally address saved ({address}). Review and approve the bill again." : $"Tally address saved ({address})." };
                }
            case "allocate":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); var trip = await Get<Trip>(Str(d, "tripId")); Check(trip.State == "Open", "Trip has already departed."); var cust = await Get<Customer>(Str(d, "customerId")); Check(Str(d, "destination").Length >= 3, "Delivery destination required."); var cartons = await Selected(d);
                    Check(cartons.All(c => c.Verified && c.Attached && !c.Held && c.State == "Available"), "Every selected carton must have its labels and contents confirmed, be unheld and available."); Check(cartons.Select(c => c.WarehouseId).Distinct().Count() == 1, "Select one warehouse per shipment."); Check(cartons.All(c => c.CustomerId == null || c.CustomerId == cust.Id), "Cartons assigned to another customer cannot be allocated.");
                    var order = await ValidateOrderAllocation(d, cust, cartons);
                    var s = new Shipment { Id = NewId("SH-"), CompanyId = company, Workflow = workflow, OrderId = order?.Id, TripId = trip.Id, CustomerId = cust.Id, WarehouseId = cartons[0].WarehouseId, Destination = Str(d, "destination") }; db.Shipments.Add(s);
                    foreach (var c in cartons) { c.State = "Reserved"; db.Allocations.Add(new Allocation { CompanyId = company, ShipmentId = s.Id, CartonId = c.Id }); }
                    return new { id = s.Id, message = $"{cartons.Count} cartons reserved for {cust.Name}. Remaining packed cartons stay available." };
                }
            case "startLoading":
                {
                    Permissions.Require(actor, "Loader", "DispatchSupervisor"); var s = await Get<Shipment>(Str(d, "shipmentId")); await EnsureOrderOpenForShipment(s); var trip = await Get<Trip>(s.TripId); Check(!s.LoadApproved && trip.State == "Open" && s.State is "Allocated" or "Loading", "Shipment is not open for loading.");
                    var station = Str(d, "station"); Check(station.Length is >= 2 and <= 80, "A station name is required."); var other = await db.LoadingSessions.Where(x => x.CompanyId == company && x.Station == station && x.Active).ToListAsync(); other.ForEach(x => x.Active = false); await db.SaveChangesAsync();
                    var session = new LoadingSession { CompanyId = company, UserId = actor.Id, ShipmentId = s.Id, TripId = s.TripId, Station = station }; db.LoadingSessions.Add(session); s.State = "Loading"; return new { id = session.Id, message = "Loading started. Wait for Loaded on screen after each scan." };
                }
            case "scan":
                {
                    Permissions.Require(actor, "Loader", "DispatchSupervisor"); var session = await Get<LoadingSession>(Str(d, "sessionId"));
                    Check(session.Active && session.ExpiresAt > DateTimeOffset.UtcNow && session.UserId == actor.Id && session.Station == Str(d, "station"), "Loading session expired, changed station or belongs to another operator.", 409);
                    Check(Str(d, "mode") == "live", "Stored/offline scanner replay requires supervised reconciliation.");
                    var s = await Get<Shipment>(session.ShipmentId); await EnsureOrderOpenForShipment(s); Check(!s.LoadApproved && s.State == "Loading", "Shipment is closed for loading."); var trip = await Get<Trip>(s.TripId); Check(trip.State == "Open" && trip.Id == session.TripId, "Trip context changed.");
                    Carton c; try { c = await ResolveQr(Str(d, "qr")); } catch (RuleException e) { return new { outcome = "Rejected", message = e.Message }; }
                    var allocation = await db.Allocations.SingleOrDefaultAsync(x => x.CompanyId == company && x.CartonId == c.Id && x.Active);
                    if (allocation == null || allocation.ShipmentId != s.Id || c.WarehouseId != s.WarehouseId) return new { outcome = "Rejected", message = "This carton is not reserved for the selected customer." };
                    if (allocation.State == "Loaded") return new { outcome = "Duplicate", id = c.Id, message = "Already loaded. Totals unchanged." };
                    if (!c.Verified || !c.Attached || c.Held || c.State != "Reserved" || allocation.State != "Reserved") return new { outcome = "Rejected", message = "This carton cannot be loaded. Check its status and label with a supervisor." };
                    allocation.State = "Loaded"; c.State = "Loaded"; return new { outcome = "Accepted", id = c.Id, lines = Json.Read<ContentLine[]>(c.Lines), message = "Carton loaded. All item quantities are saved." };
                }
            case "unload":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "shipmentId")); Check(!s.LoadApproved && s.InvoiceJobId == null, "Approved or invoicing shipments require a controlled correction."); var c = await Get<Carton>(Str(d, "id")); var a = await db.Allocations.SingleOrDefaultAsync(x => x.CompanyId == company && x.ShipmentId == s.Id && x.CartonId == c.Id && x.Active); Check(a != null && a.State == "Loaded" && c.State == "Loaded", "Carton is not loaded on this shipment."); a!.State = "Reserved"; c.State = "Reserved"; return new { id = c.Id, message = "Carton unloaded. Loading totals are updated. Tally stock is unchanged." };
                }
            case "releaseShipment":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "id")); Check(!s.LoadApproved && s.InvoiceJobId == null, "Cannot release an approved/invoicing shipment."); var allocations = await db.Allocations.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync(); Check(allocations.All(x => x.State == "Reserved"), "Physically unload every loaded carton first."); foreach (var a in allocations) { a.Active = false; a.State = "Released"; (await Get<Carton>(a.CartonId)).State = "Available"; }
                    s.State = "Cancelled"; return new { message = "Shipment cancelled. Reserved cartons are available again. The history is kept." };
                }
            case "approveLoad":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); Check(Flag(d, "physicalConfirmed"), "Physical load review is required."); var s = await Get<Shipment>(Str(d, "id")); await EnsureOrderOpenForShipment(s); var a = await db.Allocations.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync(); Check(a.Count > 0 && a.All(x => x.State == "Loaded"), "Load every reserved carton before approving."); Check((await Get<Trip>(s.TripId)).State == "Open", "Trip is not open."); s.LoadApproved = true; s.LoadApprovedBy = actor.Id; s.State = "LoadApproved"; foreach (var session in await db.LoadingSessions.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync()) session.Active = false; return new { message = "Physical load approved. Billing review is next." };
                }
            case "saveBilling":
                {
                    Permissions.Require(actor, "Billing"); var input = Json.Read<BillDraft>(d); Check(string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Trim().Length >= 3, "If you add a price note, enter at least 3 characters."); var s = await Get<Shipment>(input.ShipmentId); await EnsureOrderOpenForShipment(s); Check(s.LoadApproved, "Approve physical loading before billing."); Check(s.InvoiceJobId == null, "Posting job freezes the approved snapshot. Resolve it before corrections."); Check(s.BillingVersion == input.Version, "Billing revision changed. Reload.", 409);
                    var cartons = await ShipmentCartons(s.Id); var totals = cartons.SelectMany(c => Json.Read<ContentLine[]>(c.Lines)).GroupBy(l => new { l.Sku, l.Unit }).Select(g => new { g.Key.Sku, g.Key.Unit, Quantity = g.Sum(l => l.Quantity) }).ToArray();
                    Check(input.Rates.Length == totals.Length && input.Rates.Select(x => x.Sku).Distinct().Count() == input.Rates.Length, "Provide exactly one authorised rate for each SKU; differing units require accountant mapping.");
                    var lines = totals.Select(t => { var r = input.Rates.SingleOrDefault(x => x.Sku == t.Sku) ?? throw new RuleException($"Rate missing for {t.Sku}."); Check(r.Rate >= 0 && r.Rate <= 10000000 && r.DiscountPercent >= 0 && r.DiscountPercent <= 100, "Invalid rate or discount."); return new { t.Sku, t.Unit, t.Quantity, r.Rate, r.DiscountPercent, Net = decimal.Round(t.Quantity * r.Rate * (1 - r.DiscountPercent / 100m), 2, MidpointRounding.AwayFromZero) }; }).ToArray();
                    Check(input.Freight >= 0 && input.OtherCharges >= 0, "Charges must be non-negative."); s.BillingVersion++; s.State = "BillingDraft"; var bill = new Billing { CompanyId = company, ShipmentId = s.Id, Revision = s.BillingVersion, Snapshot = Json.Write(new { lines, input.Freight, input.OtherCharges, input.Terms, input.Reason, pricingSource = "Authorised manual entry", taxStatus = "Unresolved: no GST assumed", cartons = cartons.Select(c => new { c.Id, c.Revision, c.Lines }), customer = await Get<Customer>(s.CustomerId), s.Destination }), Total = lines.Sum(l => l.Net) + input.Freight + input.OtherCharges }; db.Billings.Add(bill); return new { id = bill.Id, total = bill.Total, revision = bill.Revision, message = "Bill changes saved. Check and approve it again. The total does not include tax yet." };
                }
            case "approveBilling":
                {
                    Permissions.Require(actor, "Billing"); var b = await Get<Billing>(Str(d, "id")); var s = await Get<Shipment>(b.ShipmentId); await EnsureOrderOpenForShipment(s); Check(s.LoadApproved && s.BillingVersion == b.Revision && s.InvoiceJobId == null, "Billing revision is no longer current or already posting."); Check(Flag(d, "physicalConfirmed"), "Review customer, contents, rates and charges before approving."); b.Approved = true; b.ApprovedBy = actor.Id; b.ApprovedAt = DateTimeOffset.UtcNow; s.State = "BillingApproved"; return new { message = "Bill approved. Tally setup must still be checked before sending." };
                }
            case "authorizeInvoiceRetry":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d);
                    Check(Flag(d, "verifiedNoVoucher"), "Confirm that you searched Tally for this exact reference and found no voucher.", 409);
                    var job = await Get<PostingJob>(Str(d, "id"));
                    Check(job.State == "ConfirmationUnknown", "Only an invoice with an uncertain Tally result can be retried.", 409);
                    var detail = TallyJobDetails.Read(job.Detail);
                    var payload = detail.Payload ?? throw new RuleException("This invoice has no retryable payload.", 409);
                    Check(!detail.RetryAuthorized, "A retry is already authorized.", 409);
                    Check(payload.Company == "ELECTRO GROUP OF INDUSTRIES" && payload.Environment == "Production" &&
                        (payload.Reference == "DISPATCH-" + job.Id || payload.Reference == "TEST-DISPATCH-" + job.Id),
                        "This retry is restricted to the exact immutable Electro production invoice reference.", 409);
                    var shipment = await Get<Shipment>(job.ShipmentId);
                    await EnsureOrderOpenForShipment(shipment);
                    Check(shipment.InvoiceJobId == job.Id && shipment.OrderId is { Length: > 0 }, "Invoice job no longer matches its shipment.", 409);
                    var order = await Get<DispatchOrder>(shipment.OrderId!);
                    var customer = await Get<Customer>(shipment.CustomerId);
                    Check(!IsKnownLegacyTrial(shipment, order, customer),
                        "This is a known legacy trial shipment. Its history is preserved, but it cannot be retried as a customer invoice.", 409);
                    job.Detail = Json.Write(detail with { Message = "One retry authorized after Tally was searched for the exact reference. The connector will search again before it can send.", RetryAuthorized = true });
                    Audit("authorizeInvoiceRetry", job.Id, new { job.PayloadHash, reference = payload.Reference, reason = Str(d, "reason"), verifiedNoVoucher = true });
                    return new { message = "One retry is authorized. The connector will check Tally again and will confirm an existing voucher instead of creating a duplicate." };
                }
            case "cancelUnsentInvoice":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d);
                    Check(Flag(d, "verifiedNoVoucher"), "Search Tally for the exact reference and confirm no voucher exists before retiring this request.", 409);
                    var job = await Get<PostingJob>(Str(d, "id"));
                    Check(job.State is "Queued" or "Claimed", "This invoice request has started sending or needs reconciliation; it cannot be retired as unsent.", 409);
                    Check(job.VoucherReference == null, "A voucher reference is already recorded for this request.", 409);
                    var detail = TallyJobDetails.Read(job.Detail);
                    var payload = detail.Payload ?? throw new RuleException("Invoice payload is unavailable; the request cannot be safely retired.", 409);
                    var expectedReference = Str(d, "expectedReference");
                    Check(expectedReference.Length > 0 && string.Equals(expectedReference, payload.Reference, StringComparison.Ordinal), "The reference entered does not match this invoice request. Nothing was changed.", 409);
                    var shipment = await Get<Shipment>(job.ShipmentId);
                    Check(shipment.InvoiceJobId == job.Id && shipment.State != "Departed", "This request is no longer attached to an open shipment.", 409);
                    job.State = "Rejected";
                    job.LeaseExpires = null;
                    job.Detail = Json.Write(detail with { Message = $"Retired before sending after Tally was searched for exact reference {payload.Reference}; no voucher was found. Original request and payload are retained in history." });
                    shipment.InvoiceJobId = null;
                    shipment.State = "BillingApproved";
                    return new { message = "The unsent invoice request was retired. Its history is kept, and the approved bill is ready for review and a fresh request.", reference = payload.Reference };
                }
            case "queueInvoice":
                {
                    Permissions.Require(actor, "Billing"); Check(deployment.Site?.Slug == "electro", "Tally invoice creation is enabled only for Electro Group.", 403); var s = await Get<Shipment>(Str(d, "id")); await EnsureOrderOpenForShipment(s); Check(s.InvoiceJobId == null, "A posting job already exists for this shipment."); var b = await db.Billings.SingleOrDefaultAsync(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Revision == s.BillingVersion); Check(s.LoadApproved && b is { Approved: true }, "Approve current billing and load first.");
                    var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == company); Check(mapping.ContractValidated && mapping.Pattern == "ElectroGSTInvoiceV1", "An administrator must validate the exact Tally company invoice mapping first.", 409);
                    var connector = await db.Connectors.Where(x => x.CompanyId == company && !x.Revoked && x.Environment == "Production" && x.ExpectedCompany == mapping.ExpectedCompany && x.LastSeen > DateTimeOffset.UtcNow.AddMinutes(-4)).OrderByDescending(x => x.LastSeen).FirstOrDefaultAsync(); Check(connector != null, "The paired Tally PC is not connected. Open Tally to the exact company and wait for a heartbeat.", 409);
                    var catalog = Json.Read<TallyMasterSnapshot>(connector!.MastersSnapshot); Check(catalog.Company == mapping.ExpectedCompany && catalog.Environment == "Production", "The current Tally master snapshot is for a different company or environment.", 409);
                    Check(catalog.Ledgers.Any(x => string.Equals(x.Name, mapping.SalesLedger, StringComparison.Ordinal) && string.Equals(x.Group, "Sales Accounts", StringComparison.OrdinalIgnoreCase)), $"The mapped sales ledger '{mapping.SalesLedger}' is missing from the latest Tally sync under Sales Accounts. Select a current production sales ledger in Settings and validate the mapping before queuing this invoice.", 409);
                    var testOrder = s.OrderId == null ? null : await db.Orders.SingleOrDefaultAsync(x => x.CompanyId == company && x.Id == s.OrderId);
                    var testCustomer = await Get<Customer>(s.CustomerId);
                    var demoTestInvoice = testOrder?.Reference == "PO-1234-TEST" && testCustomer.Name == "TEST - Bengaluru Machine Works";
                    Check(!IsKnownLegacyTrial(s, testOrder, testCustomer),
                        "This is a known legacy trial shipment. Its history is preserved, but it cannot be sent to Tally.", 409);
                    var taxLedgers = TallyTaxLedgerResolver.Resolve(catalog, demoTestInvoice);
                    Check(taxLedgers != null, demoTestInvoice
                        ? "The approved TEST invoice needs its three DEMO tax ledgers in Tally."
                        : "Production GST ledgers are not ready. Tally must contain one unambiguous output CGST, SGST and IGST ledger under Duties & Taxes; DEMO, purchase and input-tax ledgers are not used for customer invoices.", 409);
                    var job = new PostingJob { CompanyId = company, ShipmentId = s.Id, BillingId = b!.Id, State = "Queued" };
                    var payload = await BuildInvoicePayload(s, b!, mapping, catalog, job.Id, taxLedgers!);
                    job.Detail = Json.Write(new TallyInvoiceJobDetail("Ready to send to the Electro company.", payload));
                    job.PayloadHash = Hash(Json.Write(payload)); db.Jobs.Add(job); s.InvoiceJobId = job.Id; s.State = "InvoiceBlocked"; return new { id = job.Id, state = job.State, message = "A Tally sales invoice was queued. No driver release occurs until Tally readback is confirmed." };
                }
            case "saveMapping":
                {
                    Permissions.Require(actor, "Billing"); RequireReason(d); var m = await db.Mappings.SingleAsync(x => x.CompanyId == company); m.ExpectedCompany = Str(d, "expectedCompany"); m.TallyVersion = Str(d, "tallyVersion"); m.SalesLedger = Str(d, "salesLedger"); m.VoucherType = Str(d, "voucherType"); m.Notes = Str(d, "notes"); m.StatutoryRequired = Flag(d, "statutoryRequired"); m.ContractValidated = false; m.Pattern = "Unvalidated"; return new { message = "Tally settings saved. Production invoice posting is disabled until the company mapping is validated." };
                }
            case "validateTallyContract":
                {
                    Permissions.Require(actor, "Billing"); Check(deployment.Site?.Slug == "electro", "Only Electro's dedicated production site can validate this invoice contract.", 403); Check(Flag(d, "confirmedCompany"), "Confirm the exact Tally company."); RequireReason(d);
            var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == company); Check(mapping.ExpectedCompany == "ELECTRO GROUP OF INDUSTRIES" && mapping.VoucherType == "Sales" && mapping.SalesLedger.Length > 0, "Enter the exact company, Sales voucher type and sales ledger first.");
                    var connector = await db.Connectors.Where(x => x.CompanyId == company && !x.Revoked && x.Environment == "Production" && x.ExpectedCompany == mapping.ExpectedCompany && x.LastSeen > DateTimeOffset.UtcNow.AddMinutes(-4)).OrderByDescending(x => x.LastSeen).FirstOrDefaultAsync(); Check(connector != null, "The Tally PC must be online with the exact company selected.", 409);
                    var catalog = Json.Read<TallyMasterSnapshot>(connector!.MastersSnapshot); Check(!string.IsNullOrWhiteSpace(catalog.CompanyState), "The company state must be available from Tally.", 409);
                    Check(catalog.Ledgers.Any(x => x.Name == mapping.SalesLedger && x.Group == "Sales Accounts"), "The selected sales ledger is not present under Sales Accounts in the current Tally snapshot.", 409);
                    Check(TallyTaxLedgerResolver.Resolve(catalog, demo: false) != null, "Production GST ledgers are not ready. Tally must contain one unambiguous output CGST, SGST and IGST ledger under Duties & Taxes; DEMO, purchase and input-tax ledgers are not valid for production.", 409);
                    Check(catalog.Items.All(x => !string.IsNullOrWhiteSpace(x.HsnCode) && x.GstRate is >= 0 and <= 100), "Production item GST setup is incomplete. The accountant must verify an HSN code and GST rate for every Tally stock item, then refresh masters.", 409);
                    Check(catalog.Items.Length > 0 && catalog.Ledgers.Any(x => x.Group == "Sundry Debtors" && !string.IsNullOrWhiteSpace(x.StateName)), "Tally must export stock classifications and customer states before invoice validation.", 409);
                    mapping.ContractValidated = true; mapping.Pattern = "ElectroGSTInvoiceV1"; mapping.SyncedAt = DateTimeOffset.UtcNow; Audit("validateTallyContract", mapping.Id, new { mapping.ExpectedCompany, mapping.VoucherType, mapping.SalesLedger, connector = connector.Id, environment = "Production", reason = Str(d, "reason") }); return new { message = "Electro company invoice mapping is enabled for production." };
                }
            case "pairConnector":
                {
                    Permissions.Require(actor); var expected = Str(d, "expectedCompany"); Check(expected.Length >= 3, "Exact Tally company name required."); var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); var c = new Connector { CompanyId = company, Name = Str(d, "name"), SecretHash = Hash(secret), ExpectedCompany = expected, Environment = "Production" }; db.Connectors.Add(c); Audit(type, c.Id, new { c.Name, c.ExpectedCompany, c.Environment }); return new { id = c.Id, secret, message = "Copy this credential to the Tally PC. It is scoped to this exact company. Revoke and re-pair if lost." };
                }
            case "revokeConnector": { Permissions.Require(actor); RequireReason(d); (await Get<Connector>(Str(d, "id"))).Revoked = true; return new { message = "Connector credential revoked." }; }
            case "createUser":
                {
                    Permissions.Require(actor); var roles = Json.Read<string[]>(d.GetProperty("roles")); Check(roles.Length > 0 && roles.All(Permissions.Roles.Contains), "Choose valid roles."); var password = Str(d, "password"); Check(password.Length >= 12, "Use at least 12 characters."); var email = Str(d, "email").ToLowerInvariant(); Check(System.Net.Mail.MailAddress.TryCreate(email, out _), "Valid email required."); var u = new User { CompanyId = company, Email = email, Name = Str(d, "name"), Roles = roles }; u.PasswordHash = new Microsoft.AspNetCore.Identity.PasswordHasher<User>().HashPassword(u, password); db.Users.Add(u); Audit(type, u.Id, new { u.Email, u.Roles }); return new { id = u.Id, message = "User created." };
                }
            case "depart":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); Check(Flag(d, "physicalConfirmed"), "Confirm vehicle and physical load review."); var t = await Get<Trip>(Str(d, "id")); Check(t.State == "Open", "Trip is not open."); var shipments = await db.Shipments.Where(x => x.CompanyId == company && x.TripId == t.Id && x.State != "Cancelled").ToListAsync(); Check(shipments.Count > 0, "Trip has no shipments.");
                    foreach (var s in shipments) { await EnsureOrderOpenForShipment(s); Check(s.InvoiceJobId != null, "Each shipment requires a verified invoice."); var job = await Get<PostingJob>(s.InvoiceJobId!); Check(job.State == "Confirmed" && job.VoucherReference != null, "Every shipment needs a Tally invoice confirmed through readback."); var documents = Json.Read<Dictionary<string, string>>(s.Documents); Check(documents.GetValueOrDefault("print") == "OperatorConfirmed", "Confirm the existing invoice was printed."); var mapping = await db.Mappings.SingleAsync(x => x.CompanyId == company); if (mapping.StatutoryRequired) Check(!string.IsNullOrEmpty(documents.GetValueOrDefault("statutoryReference")), "Required statutory references unresolved."); foreach (var a in await db.Allocations.Where(x => x.CompanyId == company && x.ShipmentId == s.Id && x.Active).ToListAsync()) { Check(a.State == "Loaded", "Allocation mismatch."); a.State = "Departed"; (await Get<Carton>(a.CartonId)).State = "Departed"; } s.State = "Departed"; }
                    t.State = "Departed"; t.DepartedAt = DateTimeOffset.UtcNow; return new { message = "Departure recorded. No additional accounting stock movement created." };
                }
            case "recordDocuments":
                {
                    Permissions.Require(actor, "Billing", "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "id")); await EnsureOrderOpenForShipment(s); Check(s.State != "Departed" && s.InvoiceJobId != null, "A confirmed invoice is required before driver documents."); var job = await Get<PostingJob>(s.InvoiceJobId!); Check(job.State == "Confirmed" && !string.IsNullOrEmpty(job.VoucherReference), "Do not print an unconfirmed invoice."); var print = Str(d, "print"); Check(new[] { "Prepared", "Submitted", "Failed", "Unknown", "OperatorConfirmed" }.Contains(print), "Invalid print status."); var docs = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object?>>(s.Documents, Json.Options) ?? new Dictionary<string, object?>(); docs["print"] = print; docs["statutoryReference"] = Str(d, "statutoryReference"); docs["confirmedVoucher"] = job.VoucherReference; docs["operatorId"] = actor.Id; docs["at"] = DateTimeOffset.UtcNow; s.Documents = Json.Write(docs); return new { message = "Existing confirmed invoice document status recorded. No new sale or stock movement created." };
                }
            case "recordReturn":
                {
                    Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); var s = await Get<Shipment>(Str(d, "shipmentId")); Check(s.State == "Departed", "Use unload for pre-departure corrections."); var c = await Get<Carton>(Str(d, "id")); Check(await db.Allocations.AnyAsync(x => x.CompanyId == company && x.ShipmentId == s.Id && x.CartonId == c.Id && x.State == "Departed"), "Carton does not belong to the original departure."); var lines = await Normalize(Json.Read<ContentLine[]>(d.GetProperty("lines"))); var prior = await db.Returns.Where(x => x.CompanyId == company && x.CartonId == c.Id).ToListAsync(); var original = Json.Read<ContentLine[]>(c.Lines); foreach (var l in lines) { var available = original.Where(o => o.Sku == l.Sku && o.Unit == l.Unit && o.Batch == l.Batch && o.Godown == l.Godown).Sum(o => o.Quantity) - prior.SelectMany(p => Json.Read<ContentLine[]>(p.Lines)).Where(o => o.Sku == l.Sku && o.Unit == l.Unit && o.Batch == l.Batch && o.Godown == l.Godown).Sum(o => o.Quantity); Check(l.Quantity <= available, "Return exceeds original unreturned quantities."); }
                    var ret = new ReturnRecord { CompanyId = company, ShipmentId = s.Id, CartonId = c.Id, Lines = Json.Write(lines), Reason = Str(d, "reason"), Condition = Str(d, "condition") }; db.Returns.Add(ret); return new { id = ret.Id, message = "Return saved. Keep these goods separate. Accounts must check any credit and stock update." };
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
        var ids = Ids(d); Check(ids.Length is > 0 and <= 1000 && ids.Distinct().Count() == ids.Length, "Select 1-1,000 distinct cartons."); var rows = await db.Cartons.Where(x => x.CompanyId == company && ids.Contains(x.Id)).ToListAsync(); Check(rows.Count == ids.Length, "Carton missing or belongs to another company.");
        Check(await db.Manifests.Where(m => m.CompanyId == company && m.Workflow == workflow && rows.Select(c => c.ManifestId).Contains(m.Id)).CountAsync() == rows.Select(c => c.ManifestId).Distinct().Count(), "Choose cartons from this workflow only.", 409);
        return rows;
    }
    async Task<Carton> ResolveQr(string qr)
    {
        qr = qr.Trim();
        // Some keyboard-wedge scanners prepend the standard AIM QR symbology
        // identifier (]Qm). It describes the barcode type, not the carton ID.
        if (qr.Length > 3 && qr[0] == ']' && qr[1] == 'Q' && qr[2] is >= '0' and <= '6')
            qr = qr[3..];
        if (qr.Length <= 160 && CartonCodes.TryDecode(qr, out var compactId, out var compactRevision))
        {
            var carton = await Get<Carton>(compactId);
            Check(carton.Revision == compactRevision, "Obsolete label revision. Scan the current attached label.");
            return carton;
        }
        Check(qr.Length <= 160, "QR payload too long."); var parts = qr.Split('|'); Check(parts.Length == 4 && parts[0] == "K1" && parts[1] == company && int.TryParse(parts[3], out _), "Invalid or wrong-company carton QR. Product barcodes cannot identify cartons."); var c = await Get<Carton>(parts[2]); Check(c.Revision.ToString() == parts[3], "Obsolete label revision. Scan the current attached label."); return c;
    }
    async Task<TallyInvoicePayload> BuildInvoicePayload(Shipment shipment, Billing billing, Mapping mapping, TallyMasterSnapshot catalog, string jobId, TallyTaxLedgers taxLedgerNames)
    {
        var draft = Json.Read<InvoiceDraftSnapshot>(billing.Snapshot);
        Check(draft.Lines.Length is > 0 and <= 100, "The approved bill has no invoice lines or exceeds the invoice limit.");
        var customer = await Get<Customer>(shipment.CustomerId);
        Check(customer.InTally, "The customer is no longer present in the latest Tally master sync. Refresh Tally masters and verify the customer before invoicing.", 409);
        Check(!string.IsNullOrWhiteSpace(customer.TallyId), "The customer is not linked to an exact Tally debtor ledger.", 409);
        var party = catalog.Ledgers.SingleOrDefault(x => x.NativeId == customer.TallyId && x.Group == "Sundry Debtors");
        Check(party != null && !string.IsNullOrWhiteSpace(party.StateName), "The exact Tally customer ledger or its state is missing from the latest master snapshot.", 409);
        Check(!string.IsNullOrWhiteSpace(catalog.CompanyState), "Tally did not return the company's state.", 409);
        var partyLedger = party ?? throw new RuleException("The exact Tally customer ledger is missing from the latest master snapshot.", 409);
        var companyState = catalog.CompanyState ?? throw new RuleException("Tally did not return the company's state.", 409);
        var partyState = partyLedger.StateName ?? throw new RuleException("The Tally customer state is missing.", 409);
        Check(!string.IsNullOrWhiteSpace(shipment.Destination) && shipment.Destination.Contains(partyState.Trim(), StringComparison.OrdinalIgnoreCase), "Invoice not sent: include the delivery state in the destination and ensure it matches the Tally customer state. GST place of supply cannot be safely inferred from a city-only or different-state destination.", 409);
        var localSupply = string.Equals(companyState.Trim(), partyState.Trim(), StringComparison.OrdinalIgnoreCase);
        var invoiceLines = new List<TallyInvoiceLine>();
        decimal cgst = 0, sgst = 0, igst = 0;
        foreach (var line in draft.Lines)
        {
            var product = await db.Products.SingleOrDefaultAsync(x => x.CompanyId == company && x.Sku == line.Sku);
            Check(product != null && !string.IsNullOrWhiteSpace(product.TallyId), $"SKU {line.Sku} is not linked to a Tally stock item.", 409);
            var currentProduct = product!;
            Check(currentProduct.InTally, $"SKU {line.Sku} is no longer present in the latest Tally master sync. Refresh Tally masters before preparing a customer invoice.", 409);
            var hsnCode = currentProduct.HsnCode ?? throw new RuleException($"SKU {line.Sku} is missing its HSN. Correct its Tally classification first.", 409);
            var gstRate = currentProduct.GstRate ?? throw new RuleException($"SKU {line.Sku} is missing its GST rate. Correct its Tally classification first.", 409);
            Check(!string.IsNullOrWhiteSpace(hsnCode) && gstRate is >= 0 and <= 100, $"SKU {line.Sku} has invalid HSN/GST details.", 409);
            var item = catalog.Items.SingleOrDefault(x => x.NativeId == currentProduct.TallyId);
            Check(item != null && item.Name == currentProduct.TallyName && item.Unit == line.Unit, $"SKU {line.Sku} no longer matches its exact Tally item and base unit. Refresh the masters and review the bill.", 409);
            var currentItem = item!;
            Check(currentItem.HsnCode == hsnCode && currentItem.GstRate == gstRate, $"SKU {line.Sku} HSN/GST values changed in Tally. Refresh Tally masters and review the bill again.", 409);
            Check(!string.IsNullOrWhiteSpace(currentItem.HsnCode) && currentItem.GstRate is >= 0 and <= 100, $"SKU {line.Sku} needs an HSN code and GST rate in Tally before a customer invoice can be created.", 409);
            Check(currentProduct.BookBalance != null && currentProduct.BookBalance >= line.Quantity, $"Tally has insufficient booked stock for SKU {line.Sku}. Check the stock balance in Tally before invoicing.", 409);
            var amount = decimal.Round(line.Net, 2, MidpointRounding.AwayFromZero);
            Check(line.Quantity > 0 && line.Rate >= 0 && amount >= 0 && decimal.Abs(line.Net - amount) <= 0.01m, $"SKU {line.Sku} has an invalid approved amount.");
            var lineGst = decimal.Round(amount * gstRate / 100m, 2, MidpointRounding.AwayFromZero);
            if (localSupply) { var centralTax = decimal.Round(lineGst / 2m, 2, MidpointRounding.AwayFromZero); cgst += centralTax; sgst += lineGst - centralTax; }
            else igst += lineGst;
            invoiceLines.Add(new TallyInvoiceLine(line.Sku, currentProduct.TallyId!, currentItem.Name, line.Unit, line.Quantity, line.Rate, line.DiscountPercent, amount, gstRate, hsnCode, currentProduct.BookBalance));
        }
        var itemTaxable = invoiceLines.Sum(x => x.Amount);
        var charges = draft.Freight + draft.OtherCharges;
        if (charges > 0 && itemTaxable <= 0) throw new RuleException("Freight and other charges require taxable product lines.", 409);
        // Apply each charge across the invoice's GST-rate mix in proportion to
        // its taxable product value. This keeps mixed-rate invoices accurate.
        var chargeCgst = 0m; var chargeSgst = 0m; var chargeIgst = 0m;
        if (charges > 0)
        {
            var buckets = invoiceLines.GroupBy(x => x.GstRate).Select(g => new { Rate = g.Key, Share = g.Sum(x => x.Amount) / itemTaxable }).OrderBy(x => x.Rate).ToArray();
            var allocated = 0m;
            for (var i = 0; i < buckets.Length; i++)
            {
                var baseAmount = i == buckets.Length - 1 ? charges - allocated : decimal.Round(charges * buckets[i].Share, 2, MidpointRounding.AwayFromZero);
                allocated += baseAmount;
                var tax = decimal.Round(baseAmount * buckets[i].Rate / 100m, 2, MidpointRounding.AwayFromZero);
                if (localSupply) { var half = decimal.Round(tax / 2m, 2, MidpointRounding.AwayFromZero); chargeCgst += half; chargeSgst += tax - half; }
                else chargeIgst += tax;
            }
        }
        var taxable = itemTaxable + charges;
        cgst = decimal.Round(cgst + chargeCgst, 2, MidpointRounding.AwayFromZero); sgst = decimal.Round(sgst + chargeSgst, 2, MidpointRounding.AwayFromZero); igst = decimal.Round(igst + chargeIgst, 2, MidpointRounding.AwayFromZero);
        var india = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "India Standard Time" : "Asia/Kolkata");
        var date = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, india).ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture);
        var total = taxable + cgst + sgst + igst;
        var reference = taxLedgerNames.Demo ? "TEST-DISPATCH-" + jobId : "DISPATCH-" + jobId;
        var narrationParts = new List<string> { "Electro Dispatch invoice " + jobId };
        if (!string.IsNullOrWhiteSpace(draft.Terms)) narrationParts.Add("Terms: " + draft.Terms.Trim());
        if (!string.IsNullOrWhiteSpace(draft.Reason)) narrationParts.Add("Price / terms note: " + draft.Reason.Trim());
        var finalPayload = new TallyInvoicePayload(jobId, mapping.ExpectedCompany, "Production", mapping.VoucherType, date,
            partyLedger.Name, partyState, companyState, mapping.SalesLedger, taxLedgerNames.Cgst, taxLedgerNames.Sgst,
            taxLedgerNames.Igst, "Forwarding Charges", "Main Location", reference,
            (taxLedgerNames.Demo ? "TEST ONLY - accountant-approved demo GST values; " : "") + string.Join(" | ", narrationParts),
            draft.Terms ?? "", draft.Freight, draft.OtherCharges,
            invoiceLines.ToArray(), taxable, cgst, sgst, igst, total);
        return finalPayload;
    }
    sealed record InvoiceDraftSnapshot(InvoiceDraftLine[] Lines, decimal Freight, decimal OtherCharges, string? Terms, string? Reason);
    sealed record InvoiceDraftLine(string Sku, string Unit, decimal Quantity, decimal Rate, decimal DiscountPercent, decimal Net);
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
            Check(l.Quantity > 0 && l.Quantity <= 100000000 && decimal.Round(l.Quantity, 6) == l.Quantity, "Quantities must be positive with at most six decimal places."); var product = await db.Products.SingleOrDefaultAsync(x => x.CompanyId == company && x.Sku == l.Sku); Check(product != null, $"Unknown exact SKU '{l.Sku}'."); Check(product!.InTally, $"SKU {l.Sku} is no longer present in the latest Tally master sync. Refresh Tally masters before using it.", 409); decimal factor = 1; if (l.Unit != product.Unit) { var conversion = await db.Conversions.SingleOrDefaultAsync(x => x.CompanyId == company && x.ProductId == product.Id && x.FromUnit == l.Unit && x.BaseUnit == product.Unit); Check(conversion != null && conversion.Factor > 0, $"Missing validated conversion: {l.Sku} / {l.Unit}."); factor = conversion!.Factor; }
            Check(l.Batch == null && l.Godown == null, "Batch/godown content capture requires validated Tally mapping; no defaults are invented."); normalized.Add(l with { BaseQuantity = l.Quantity * factor, BaseUnit = product.Unit });
        }
        return normalized.ToArray();
    }
    static Dictionary<string, decimal> Totals(IEnumerable<Carton> cartons) => cartons.SelectMany(c => Json.Read<ContentLine[]>(c.Lines)).GroupBy(l => l.Sku + "|" + l.Unit + "|" + l.Batch + "|" + l.Godown).ToDictionary(g => g.Key, g => g.Sum(l => l.Quantity));
    async Task<List<Carton>> ShipmentCartons(string id) => await db.Cartons.Where(c => c.CompanyId == company && db.Allocations.Any(a => a.CompanyId == company && a.ShipmentId == id && a.CartonId == c.Id && a.Active)).ToListAsync();
}
