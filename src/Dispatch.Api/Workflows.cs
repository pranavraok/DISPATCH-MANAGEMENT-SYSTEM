using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public static class Workflows
{
    public const string StockFirst = "StockFirst";
    public const string OrderFirst = "OrderFirst";
    public const string SqlCheck = "\"Workflow\" IN ('StockFirst','OrderFirst')";
    public static string Parse(string? value) => value switch
    {
        null or "" => StockFirst,
        StockFirst => StockFirst,
        OrderFirst => OrderFirst,
        _ => throw new RuleException("Choose Pack before order or Order first.")
    };
}

public record OrderDraft(string Reference, string CustomerId, string WarehouseId, string Destination,
    int ExpectedCartons, ContentLine[] Lines, string Notes, PackedGroup[]? BoxGroups = null);

public sealed partial class Operations
{
    string workflow = Workflows.StockFirst;

    async Task CheckWorkflow(Scoped record)
    {
        string? recordWorkflow = record switch
        {
            Manifest m => m.Workflow,
            Trip t => t.Workflow,
            Shipment s => s.Workflow,
            DispatchOrder o => o.Workflow,
            LabelJob j => j.Workflow,
            Carton c => await db.Manifests.Where(m => m.CompanyId == company && m.Id == c.ManifestId).Select(m => m.Workflow).SingleAsync(),
            LoadingSession s => await ShipmentWorkflow(s.ShipmentId),
            Billing b => await ShipmentWorkflow(b.ShipmentId),
            PostingJob j => await ShipmentWorkflow(j.ShipmentId),
            ReturnRecord r => await ShipmentWorkflow(r.ShipmentId),
            _ => null
        };
        Check(recordWorkflow == null || recordWorkflow == workflow, "This record belongs to the other workflow. Switch workflow to open it.", 409);
    }

    Task<string> ShipmentWorkflow(string id) => db.Shipments.Where(s => s.CompanyId == company && s.Id == id).Select(s => s.Workflow).SingleAsync();

    async Task<object> CreateOrder(JsonElement d)
    {
        Permissions.Require(actor, "DispatchSupervisor", "PackingSupervisor", "Billing");
        var input = Json.Read<OrderDraft>(d);
        var reference = input.Reference?.Trim() ?? "";
        var destination = input.Destination?.Trim() ?? "";
        Check(reference.Length is >= 2 and <= 100 && destination.Length is >= 3 and <= 300, "Provide an order reference and delivery destination.");
        Check(input.ExpectedCartons is >= 1 and <= 10000, "Enter 1-10,000 expected cartons.");
        Check((input.Notes?.Length ?? 0) <= 2000 && input.Lines is { Length: <= 100 }, "Provide valid order notes and product quantities.");
        var customer = await Get<Customer>(input.CustomerId);
        Check(customer.InTally, "This customer is no longer in the latest Tally sync. Refresh Tally masters before starting a new order.", 409);
        await Get<Warehouse>(input.WarehouseId);
        Check(!await db.Orders.AnyAsync(o => o.CompanyId == company && o.Workflow == workflow && o.Reference == reference), "This order reference already exists in this workflow.", 409);
        ContentLine[] lines;
        if (workflow == Workflows.OrderFirst)
        {
            var groups = input.BoxGroups ?? [];
            await ValidateGroups(groups);
            Check(groups.Sum(x => (long)x.Count) == input.ExpectedCartons,
                "The number of boxes in the product groups must equal the total boxes ordered.");
            var requiredTotals = new Dictionary<(string Sku, string Unit), decimal>();
            foreach (var group in groups)
            foreach (var line in await Normalize(group.Lines))
            {
                var key = (line.Sku, line.BaseUnit ?? line.Unit);
                requiredTotals[key] = requiredTotals.GetValueOrDefault(key) + (line.BaseQuantity ?? line.Quantity) * group.Count;
            }
            lines = requiredTotals.Select(x => new ContentLine(x.Key.Sku, x.Value, x.Key.Unit, BaseQuantity: x.Value, BaseUnit: x.Key.Unit)).ToArray();
            var orderForValidation = new DispatchOrder { Id = NewId("OR-"), CompanyId = company, Workflow = workflow, Reference = reference, CustomerId = input.CustomerId, WarehouseId = input.WarehouseId, Destination = destination, ExpectedCartons = input.ExpectedCartons, Lines = Json.Write(lines), Notes = input.Notes ?? "" };
            await ValidateOrderPacking(orderForValidation, groups, null);
            db.Orders.Add(orderForValidation);
            // The OrderFirst form captures the exact box groups, so make the cartons
            // label-ready when the order is saved instead of showing a second checklist.
            var manifest = new Manifest { Id = NewId("PK-"), CompanyId = company, Workflow = workflow, OrderId = orderForValidation.Id, WarehouseId = orderForValidation.WarehouseId, CustomerId = orderForValidation.CustomerId, Name = "Packing " + orderForValidation.Reference, Notes = "Box contents recorded with customer order", Groups = Json.Write(groups), State = "Approved", ApprovedBy = actor.Id, ApprovedAt = DateTimeOffset.UtcNow, Version = 2 };
            db.Manifests.Add(manifest);
            foreach (var group in groups)
            {
                var normalized = Json.Write(await Normalize(group.Lines));
                for (var i = 0; i < group.Count; i++)
                    db.Cartons.Add(new Carton { Id = NewId("CT-"), CompanyId = company, ManifestId = manifest.Id, WarehouseId = manifest.WarehouseId, CustomerId = manifest.CustomerId, Marking = group.Marking, Lines = normalized });
            }
            return new { id = orderForValidation.Id, manifestId = manifest.Id, message = "Order and box contents saved. Print and attach the box labels next." };
        }
        lines = input.Lines!.Length == 0 ? [] : await Normalize(input.Lines);
        var order = new DispatchOrder { Id = NewId("OR-"), CompanyId = company, Workflow = workflow, Reference = reference, CustomerId = input.CustomerId, WarehouseId = input.WarehouseId, Destination = destination, ExpectedCartons = input.ExpectedCartons, Lines = Json.Write(lines), Notes = input.Notes ?? "" };
        db.Orders.Add(order);
        return new { id = order.Id, message = workflow == Workflows.OrderFirst ? "Order saved. Pack and label cartons for this order next." : "Order saved. Choose the labelled stock for its shipment next." };
    }

    async Task<object> DeleteOrder(JsonElement d)
    {
        Permissions.Require(actor, "DispatchSupervisor"); RequireReason(d); Check(Flag(d, "confirmed"), "Confirm deleting this unused order.");
        var order = await Get<DispatchOrder>(Str(d, "id"));
        Check(!await db.Manifests.AnyAsync(m => m.CompanyId == company && m.OrderId == order.Id) && !await db.Shipments.AnyAsync(s => s.CompanyId == company && s.OrderId == order.Id), "This order has packing or shipment history. Keep it for traceability.");
        Audit("deletedOrderContents", order.Id, new { order, reason = Str(d, "reason") }); db.Orders.Remove(order);
        return new { message = "Unused order deleted." };
    }

    async Task<object> CancelOrder(JsonElement d)
    {
        Permissions.Require(actor, "DispatchSupervisor");
        RequireReason(d);
        Check(Flag(d, "confirmed"), "Confirm cancelling this customer order.");
        var order = await Get<DispatchOrder>(Str(d, "id"));
        Check(order.State == "Open", "This order is already cancelled.", 409);
        Check(string.Equals(Str(d, "confirmation"), order.Reference, StringComparison.Ordinal), "Enter the exact PO reference to confirm cancellation.");

        var shipments = await db.Shipments.Where(x => x.CompanyId == company && x.OrderId == order.Id && x.State != "Cancelled").ToListAsync();
        var shipmentIds = shipments.Select(x => x.Id).ToArray();
        var jobs = shipmentIds.Length == 0 ? [] : await db.Jobs.Where(x => x.CompanyId == company && shipmentIds.Contains(x.ShipmentId)).ToListAsync();
        var cancelledJobs = 0;
        foreach (var job in jobs.Where(x => x.State is "Queued" or "Claimed"))
        {
            var detail = TallyJobDetails.Read(job.Detail);
            job.State = "Rejected";
            job.LeaseExpires = null;
            job.Detail = Json.Write(detail with { Message = $"PO {order.Reference} was cancelled before this invoice was sent. No Tally voucher was created by this request.", RetryAuthorized = false });
            var shipment = shipments.Single(x => x.Id == job.ShipmentId);
            if (shipment.InvoiceJobId == job.Id) shipment.InvoiceJobId = null;
            cancelledJobs++;
        }
        foreach (var job in jobs.Where(x => x.State is "ConfirmationUnknown" or "NeedsReview"))
        {
            var detail = TallyJobDetails.Read(job.Detail);
            if (detail.RetryAuthorized) job.Detail = Json.Write(detail with { Message = $"PO {order.Reference} was cancelled. This invoice can only be reconciled against Tally; automatic resend is disabled.", RetryAuthorized = false });
        }

        var releasedCartons = 0;
        var shipmentsNeedingPhysicalReview = 0;
        foreach (var shipment in shipments)
        {
            var sessions = await db.LoadingSessions.Where(x => x.CompanyId == company && x.ShipmentId == shipment.Id && x.Active).ToListAsync();
            sessions.ForEach(x => x.Active = false);
            var allocations = await db.Allocations.Where(x => x.CompanyId == company && x.ShipmentId == shipment.Id && x.Active).ToListAsync();
            if (!shipment.LoadApproved && shipment.InvoiceJobId == null && shipment.State != "Departed" && allocations.All(x => x.State == "Reserved"))
            {
                foreach (var allocation in allocations)
                {
                    allocation.Active = false;
                    allocation.State = "Released";
                    (await Get<Carton>(allocation.CartonId)).State = "Available";
                    releasedCartons++;
                }
                shipment.State = "Cancelled";
            }
            else if (shipment.State != "Departed") shipmentsNeedingPhysicalReview++;
        }

        order.State = "Cancelled";
        var invoicesAlreadySentOrConfirmed = jobs.Count(x => x.State is "Sending" or "ConfirmationUnknown" or "NeedsReview" or "Confirmed");
        Audit("orderCancelled", order.Id, new { order.Reference, reason = Str(d, "reason"), cancelledQueuedInvoices = cancelledJobs, releasedCartons, shipmentsNeedingPhysicalReview, invoicesAlreadySentOrConfirmed });
        var message = $"PO {order.Reference} cancelled in Dispatch. Its order, packing, scan and shipment history is retained. {releasedCartons} reserved box(es) were safely released.";
        if (shipmentsNeedingPhysicalReview > 0) message += $" {shipmentsNeedingPhysicalReview} shipment(s) still need physical or accounting review; they were not erased.";
        if (invoicesAlreadySentOrConfirmed > 0) message += " An invoice was already being sent, uncertain, under review or confirmed; cancellation does not delete or reverse it in Tally.";
        return new { id = order.Id, message };
    }

    async Task<object> DeleteDemoOrder(JsonElement d)
    {
        Permissions.Require(actor, "Admin");
        Check(deployment.Site?.Slug == "electro" && workflow == Workflows.OrderFirst, "Test-order cleanup is available only in Electro's order workflow.", 403);
        RequireReason(d);
        Check(Str(d, "confirmation") == "PO-1234-TEST", "Type PO-1234-TEST to confirm the exact test order.");

        var order = await Get<DispatchOrder>(Str(d, "id"));
        Check(order.Reference == "PO-1234-TEST" && order.Workflow == Workflows.OrderFirst,
            "Only the known PO-1234-TEST order can be removed by this cleanup.", 409);
        var customer = await Get<Customer>(order.CustomerId);
        Check(customer.Name == "TEST - Bengaluru Machine Works", "The order is not the known test-customer order.", 409);

        var manifests = await db.Manifests.Where(x => x.CompanyId == company && x.OrderId == order.Id).ToListAsync();
        var manifestIds = manifests.Select(x => x.Id).ToArray();
        var cartons = manifestIds.Length == 0 ? [] : await db.Cartons.Where(x => x.CompanyId == company && manifestIds.Contains(x.ManifestId)).ToListAsync();
        var cartonIds = cartons.Select(x => x.Id).ToArray();
        var shipments = await db.Shipments.Where(x => x.CompanyId == company && x.OrderId == order.Id).ToListAsync();
        var shipmentIds = shipments.Select(x => x.Id).ToArray();
        Check(shipments.All(x => x.State != "Departed") && cartons.All(x => x.State != "Departed"),
            "This test order has departure history, so it must remain for traceability.", 409);
        Check(shipmentIds.Length == 0 || !await db.Returns.AnyAsync(x => x.CompanyId == company && shipmentIds.Contains(x.ShipmentId)),
            "This test order has return history, so it must remain for traceability.", 409);

        var allocations = await db.Allocations.Where(x => x.CompanyId == company &&
            (shipmentIds.Contains(x.ShipmentId) || cartonIds.Contains(x.CartonId))).ToListAsync();
        Check(allocations.All(x => shipmentIds.Contains(x.ShipmentId) && cartonIds.Contains(x.CartonId)),
            "A test carton is linked to another shipment; cleanup stopped to protect that shipment.", 409);
        var tripIds = shipments.Select(x => x.TripId).Distinct().ToArray();
        var trips = tripIds.Length == 0 ? [] : await db.Trips.Where(x => x.CompanyId == company && tripIds.Contains(x.Id)).ToListAsync();
        Check(trips.All(x => x.State != "Departed") && (tripIds.Length == 0 ||
            !await db.Shipments.AnyAsync(x => x.CompanyId == company && tripIds.Contains(x.TripId) && !shipmentIds.Contains(x.Id))),
            "A trip is departed or shared with another order; cleanup stopped to protect its history.", 409);

        var loadSessions = shipmentIds.Length == 0 ? [] : await db.LoadingSessions.Where(x => x.CompanyId == company && shipmentIds.Contains(x.ShipmentId)).ToListAsync();
        var billings = shipmentIds.Length == 0 ? [] : await db.Billings.Where(x => x.CompanyId == company && shipmentIds.Contains(x.ShipmentId)).ToListAsync();
        var billingIds = billings.Select(x => x.Id).ToArray();
        var jobs = shipmentIds.Length == 0 ? [] : await db.Jobs.Where(x => x.CompanyId == company && shipmentIds.Contains(x.ShipmentId)).ToListAsync();
        var labels = await db.Labels.Where(x => x.CompanyId == company && x.Workflow == Workflows.OrderFirst).ToListAsync();
        labels = labels.Where(label => cartonIds.Any(id => label.CartonSnapshots.Contains(id, StringComparison.OrdinalIgnoreCase))).ToList();

        // Keep operational audit and outbox rows. Audit is append-only in production,
        // and these records preserve the trace of the test workflow and its cleanup.

        if (labels.Count > 0) db.Labels.RemoveRange(labels);
        if (allocations.Count > 0) db.Allocations.RemoveRange(allocations);
        if (loadSessions.Count > 0) db.LoadingSessions.RemoveRange(loadSessions);
        if (jobs.Count > 0) db.Jobs.RemoveRange(jobs);
        if (billings.Count > 0) db.Billings.RemoveRange(billings);
        if (shipments.Count > 0) db.Shipments.RemoveRange(shipments);
        if (cartons.Count > 0) db.Cartons.RemoveRange(cartons);
        if (manifests.Count > 0) db.Manifests.RemoveRange(manifests);
        foreach (var trip in trips) db.Trips.Remove(trip);
        db.Orders.Remove(order);

        return new { message = "The PO-1234-TEST order and its undeparated Dispatch trial records were removed. Other order history and the separate Tally voucher were left untouched." };
    }

    async Task ValidateOrderPacking(DispatchOrder order, PackedGroup[] groups, string? excludeManifest)
    {
        Check(order.State == "Open", "This order is closed.");
        var existing = await db.Cartons.Where(c => c.CompanyId == company && c.ManifestId != excludeManifest && c.State != "Retired" && db.Manifests.Any(m => m.CompanyId == company && m.Id == c.ManifestId && m.OrderId == order.Id)).ToListAsync();
        Check(existing.Count + groups.Sum(g => g.Count) <= order.ExpectedCartons, "Packing would exceed the order's expected carton count.");
        var added = new List<Carton>();
        foreach (var group in groups) added.AddRange(Enumerable.Repeat(new Carton { Lines = Json.Write(await Normalize(group.Lines)) }, group.Count));
        CheckRequiredContents(order, existing.Concat(added));
    }

    static void CheckRequiredContents(DispatchOrder order, IEnumerable<Carton> cartons)
    {
        var required = Json.Read<ContentLine[]>(order.Lines);
        if (required.Length == 0) return;
        var limits = required.GroupBy(l => l.Sku + "|" + (l.BaseUnit ?? l.Unit)).ToDictionary(g => g.Key, g => g.Sum(l => l.BaseQuantity ?? l.Quantity));
        var boxes = cartons.ToArray();
        var actual = boxes.SelectMany(c => Json.Read<ContentLine[]>(c.Lines)).GroupBy(l => l.Sku + "|" + (l.BaseUnit ?? l.Unit)).ToDictionary(g => g.Key, g => g.Sum(l => l.BaseQuantity ?? l.Quantity));
        foreach (var entry in actual)
        {
            var parts = entry.Key.Split('|', 2);
            var sku = parts[0]; var unit = parts.Length > 1 ? parts[1] : "units";
            if (!limits.TryGetValue(entry.Key, out var max))
                throw new RuleException($"{sku} is not listed in {order.Reference}'s product totals. Remove it or update the order totals before saving.");
            Check(entry.Value <= max, $"{sku}: packed {entry.Value:0.######} {unit} so far, but {order.Reference} allows {max:0.######} {unit} total across all boxes.");
        }
        if (boxes.Length == order.ExpectedCartons)
        {
            foreach (var entry in limits)
            {
                var parts = entry.Key.Split('|', 2);
                var sku = parts[0]; var unit = parts.Length > 1 ? parts[1] : "units";
                var packed = actual.GetValueOrDefault(entry.Key);
                Check(packed == entry.Value, $"{sku}: {order.Reference} requires {entry.Value:0.######} {unit} total, but the {boxes.Length} box(es) contain {packed:0.######} {unit}. Adjust the box quantities to match.");
            }
        }
    }

    async Task<DispatchOrder?> ValidateOrderAllocation(JsonElement d, Customer customer, List<Carton> cartons)
    {
        Check(customer.InTally, "This customer is no longer in the latest Tally sync. Refresh Tally masters before creating a shipment.", 409);
        var id = Str(d, "orderId");
        if (id.Length == 0) { Check(workflow == Workflows.StockFirst, "Choose the customer order before reserving its cartons."); return null; }
        var order = await Get<DispatchOrder>(id);
        Check(order.State == "Open" && order.CustomerId == customer.Id && order.Destination == Str(d, "destination") && cartons.All(c => c.WarehouseId == order.WarehouseId), "Customer, destination and warehouse must match the selected order.");
        if (workflow == Workflows.OrderFirst)
        {
            var manifests = await db.Manifests.Where(m => m.CompanyId == company && m.OrderId == id).Select(m => m.Id).ToArrayAsync();
            Check(cartons.All(c => manifests.Contains(c.ManifestId)), "Use only cartons packed for this exact order, even when the customer is the same.");
        }
        var previous = await db.Cartons.Where(c => c.CompanyId == company && db.Allocations.Any(a => a.CompanyId == company && a.Active && a.CartonId == c.Id && db.Shipments.Any(s => s.CompanyId == company && s.Id == a.ShipmentId && s.OrderId == id && s.State != "Cancelled"))).ToListAsync();
        Check(previous.Count + cartons.Count <= order.ExpectedCartons, "This shipment would exceed the remaining cartons on the order.");
        CheckRequiredContents(order, previous.Concat(cartons));
        return order;
    }

    async Task<string?> PrepareOrderShipment(DispatchOrder order)
    {
        Check(order.State == "Open", "This order is cancelled and cannot be prepared for loading.", 409);
        Check(order.Workflow == Workflows.OrderFirst, "Automatic loading preparation is available for customer-first orders only.", 409);
        var manifestIds = await db.Manifests.Where(m => m.CompanyId == company && m.OrderId == order.Id && m.State == "Approved").Select(m => m.Id).ToArrayAsync();
        var cartons = await db.Cartons.Where(c => c.CompanyId == company && manifestIds.Contains(c.ManifestId) && c.State != "Retired").ToListAsync();
        Check(cartons.Count <= order.ExpectedCartons, $"{order.Reference} has more boxes packed than ordered. Correct the packing list before loading.", 409);
        if (cartons.Count != order.ExpectedCartons || cartons.Any(c => !c.Verified || !c.Attached || c.Held || c.State is not ("Available" or "Reserved" or "Loaded" or "Departed"))) return null;

        var orderShipments = db.Shipments.Where(s => s.CompanyId == company && s.OrderId == order.Id && s.State != "Cancelled");
        var allocatedIds = await db.Allocations.Where(a => a.CompanyId == company && a.Active && orderShipments.Any(s => s.Id == a.ShipmentId)).Select(a => a.CartonId).Distinct().ToArrayAsync();
        Check(allocatedIds.Length <= order.ExpectedCartons, $"{order.Reference} already has more boxes allocated than ordered. Review its shipment history.", 409);
        var remaining = order.ExpectedCartons - allocatedIds.Length;
        if (remaining == 0) return null;
        var assigned = allocatedIds.ToHashSet(StringComparer.Ordinal);
        var eligible = cartons.Where(c => c.State == "Available" && !assigned.Contains(c.Id)).ToList();
        if (eligible.Count != remaining) return null;

        var openTripId = await orderShipments.Join(db.Trips, s => s.TripId, t => t.Id, (s, t) => t)
            .Where(t => t.State == "Open" && t.Vehicle == "" && t.Driver == "")
            .Select(t => t.Id).FirstOrDefaultAsync();
        var tripId = openTripId ?? NewId("TR-");
        if (openTripId == null) db.Trips.Add(new Trip { Id = tripId, CompanyId = company, Workflow = order.Workflow, Vehicle = "", Driver = "", Transporter = "" });

        var shipment = new Shipment { Id = NewId("SH-"), CompanyId = company, Workflow = order.Workflow, OrderId = order.Id, TripId = tripId, CustomerId = order.CustomerId, WarehouseId = order.WarehouseId, Destination = order.Destination };
        db.Shipments.Add(shipment);
        foreach (var carton in eligible)
        {
            carton.State = "Reserved";
            db.Allocations.Add(new Allocation { CompanyId = company, ShipmentId = shipment.Id, CartonId = carton.Id });
        }
        return shipment.Id;
    }
}
