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
    int ExpectedCartons, ContentLine[] Lines, string Notes);

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
        await Get<Customer>(input.CustomerId); await Get<Warehouse>(input.WarehouseId);
        Check(!await db.Orders.AnyAsync(o => o.CompanyId == company && o.Workflow == workflow && o.Reference == reference), "This order reference already exists in this workflow.", 409);
        var lines = input.Lines!.Length == 0 ? [] : await Normalize(input.Lines);
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
        foreach (var entry in actual) Check(limits.TryGetValue(entry.Key, out var max) && entry.Value <= max, "Carton contents exceed or do not match the products on this order.");
        if (boxes.Length == order.ExpectedCartons) Check(limits.Count == actual.Count && limits.All(entry => actual.GetValueOrDefault(entry.Key) == entry.Value), "The full carton count does not match all ordered product quantities. Check the packing contents.");
    }

    async Task<DispatchOrder?> ValidateOrderAllocation(JsonElement d, Customer customer, List<Carton> cartons)
    {
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
}
