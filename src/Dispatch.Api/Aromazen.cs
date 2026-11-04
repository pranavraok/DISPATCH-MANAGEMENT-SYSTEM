using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public sealed partial class Operations
{
    bool Aromazen => deployment.Site?.Slug == "aromazon";
    string InitialCartonState => Aromazen ? "PendingLabel" : "Available";
    void RequireAromazen() => Check(Aromazen && workflow == Workflows.StockFirst, "This operation belongs to AROMAZEN's packed inventory workflow.", 403);

    async Task<object> RegisterStockCartons(JsonElement d)
    {
        RequireAromazen(); Permissions.Require(actor, "PackingClerk", "PackingSupervisor");
        var input = Json.Read<GroupDraft>(d);
        Check(input.Name.Length is >= 3 and <= 120, "Enter a packing batch name.");
        Check(input.CustomerId == null && input.OrderId == null, "Pack into general inventory before selecting a customer.");
        await Get<Warehouse>(input.WarehouseId); await ValidateGroups(input.Groups);
        Check(input.Groups.Sum(g => (long)g.Count) <= 1000, "Split packing runs into label batches of at most 1,000 cartons.");
        var manifest = new Manifest { Id = NewId("PK-"), CompanyId = company, Workflow = workflow, WarehouseId = input.WarehouseId, Name = input.Name, Notes = input.Notes ?? "", Groups = Json.Write(input.Groups), State = "Approved", Version = 2 };
        db.Manifests.Add(manifest);
        var cartons = new List<Carton>();
        foreach (var group in input.Groups)
        {
            var contents = Json.Write(await Normalize(group.Lines));
            for (var i = 0; i < group.Count; i++)
                cartons.Add(new Carton { Id = NewId("CT-"), CompanyId = company, ManifestId = manifest.Id, WarehouseId = manifest.WarehouseId, State = "PendingLabel", Marking = group.Marking, Lines = contents });
        }
        db.Cartons.AddRange(cartons);
        return new { id = manifest.Id, cartons, message = "Carton contents saved. Generate their QR labels to add the cartons and products to inventory." };
    }

    public async Task<object> LookupCarton(User user, string qr)
    {
        actor = user; company = user.CompanyId;
        Check(deployment.Site == null || deployment.Site.CompanyId == company, "Wrong company.", 403);
        workflow = deployment.Site?.Workflow ?? Workflows.StockFirst;
        var carton = await ResolveQr(qr);
        return new { carton, lines = Json.Read<ContentLine[]>(carton.Lines) };
    }

    public async Task<PackedInventorySummary> ReadPackedInventory(User user)
    {
        Check(Aromazen && user.CompanyId == deployment.Site!.CompanyId, "Inventory unavailable for this company.", 403);
        var companyId = user.CompanyId;
        var cartons = db.Cartons.Where(c => c.CompanyId == companyId && db.Manifests.Any(m => m.CompanyId == companyId && m.Id == c.ManifestId && m.Workflow == Workflows.StockFirst));
        var products = await db.Database.SqlQuery<PackedProductBalance>($"""
            SELECT line->>'sku' AS "Sku",
                   COALESCE(line->>'baseUnit', line->>'unit') AS "Unit",
                   SUM(COALESCE(line->>'baseQuantity', line->>'quantity')::numeric) AS "Quantity",
                   COUNT(DISTINCT c."Id") AS "Cartons"
            FROM "Cartons" c
            JOIN "Manifests" m ON m."Id" = c."ManifestId" AND m."CompanyId" = c."CompanyId"
            CROSS JOIN LATERAL jsonb_array_elements(c."Lines"::jsonb) AS line
            WHERE c."CompanyId" = {companyId} AND m."Workflow" = 'StockFirst'
              AND c."State" = 'Available' AND NOT c."Held"
            GROUP BY line->>'sku', COALESCE(line->>'baseUnit', line->>'unit')
            """).OrderBy(p => p.Sku).ToArrayAsync();
        return new PackedInventorySummary(
            await cartons.CountAsync(c => c.State == "Available" && !c.Held),
            await cartons.CountAsync(c => c.State == "PendingLabel"),
            await cartons.CountAsync(c => c.Held && c.State == "Available"),
            await cartons.CountAsync(c => c.State == "Loaded"), products);
    }

    async Task<object> BeginStockDispatch(JsonElement d)
    {
        RequireAromazen(); Permissions.Require(actor, "DispatchSupervisor");
        var customer = await Get<Customer>(Str(d, "customerId"));
        Check(customer.InTally, "Choose a current customer.", 409);
        var reference = Str(d, "reference"); var destination = Str(d, "destination");
        Check(reference.Length is >= 2 and <= 100 && destination.Length is >= 3 and <= 300, "Enter an order reference and full delivery destination including state.");
        Check(!await db.Orders.AnyAsync(x => x.CompanyId == company && x.Workflow == workflow && x.Reference == reference), "This order reference already exists. Resume its dispatch instead.", 409);
        var warehouse = await Get<Warehouse>(Str(d, "warehouseId"));
        var order = new DispatchOrder { Id = NewId("OR-"), CompanyId = company, Workflow = workflow, CustomerId = customer.Id, WarehouseId = warehouse.Id, Reference = reference, Destination = destination, ExpectedCartons = 10000, Lines = "[]", Notes = "Whole cartons selected by dispatch scan" };
        var trip = new Trip { Id = NewId("TR-"), CompanyId = company, Workflow = workflow, Vehicle = "Customer dispatch", Driver = "Not recorded" };
        var shipment = new Shipment { Id = NewId("SH-"), CompanyId = company, Workflow = workflow, OrderId = order.Id, CustomerId = customer.Id, WarehouseId = warehouse.Id, TripId = trip.Id, Destination = destination };
        db.Orders.Add(order); db.Trips.Add(trip); db.Shipments.Add(shipment);
        return new { id = shipment.Id, message = "Customer selected. Scan available cartons into this dispatch bill." };
    }

    async Task RefreshStockBill(Shipment shipment)
    {
        if (!Aromazen) return;
        var cartons = await db.Cartons.Where(c => c.CompanyId == company && db.Allocations.Any(a => a.CompanyId == company && a.ShipmentId == shipment.Id && a.CartonId == c.Id && a.Active && a.State == "Loaded")).ToListAsync();
        var products = await db.Products.Where(p => p.CompanyId == company).ToListAsync();
        var totals = cartons.SelectMany(c => Json.Read<ContentLine[]>(c.Lines)).GroupBy(l => new { l.Sku, Unit = l.BaseUnit ?? l.Unit });
        var lines = totals.Select(g => { var quantity = g.Sum(l => l.BaseQuantity ?? l.Quantity); var price = products.Single(p => p.Sku == g.Key.Sku).TallySellingPrice; return new { g.Key.Sku, g.Key.Unit, Quantity = quantity, Rate = price ?? 0m, DiscountPercent = 0m, Net = decimal.Round(quantity * (price ?? 0m), 2, MidpointRounding.AwayFromZero), priceMissing = price == null }; }).ToArray();
        shipment.BillingVersion++;
        var bill = new Billing { CompanyId = company, ShipmentId = shipment.Id, Revision = shipment.BillingVersion, Snapshot = Json.Write(new { lines, freight = 0m, otherCharges = 0m, terms = "", reason = "Generated from dispatch scans; review prices before approval", pricingSource = "Current Tally standard price where available", taxStatus = "Tax calculated during invoice validation", cartons = cartons.Select(c => new { c.Id, c.Revision, c.Lines }), customer = await Get<Customer>(shipment.CustomerId), shipment.Destination }), Total = lines.Sum(l => l.Net) };
        db.Billings.Add(bill);
    }
}

public sealed record PackedInventorySummary(int AvailableCartons, int PendingLabels, int HeldCartons, int LoadedCartons, PackedProductBalance[] Products);
public sealed class PackedProductBalance
{
    public string Sku { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal Quantity { get; set; }
    public long Cartons { get; set; }
}
