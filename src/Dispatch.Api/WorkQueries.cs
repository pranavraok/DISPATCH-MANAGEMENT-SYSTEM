using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public static class WorkQueries
{
    public static async Task<IResult> Read(string kind, string id, int? page, string? workflow, HttpContext ctx, DispatchDb db, DeploymentScope deployment)
    {
        var (user, _) = await Auth.User(ctx, db);
        var company = user.CompanyId;
        var flow = deployment.Site?.Resolve(workflow) ?? Workflows.Parse(workflow);
        var manifests = db.Manifests.Where(m => m.CompanyId == company && m.Workflow == flow);
        var shipments = db.Shipments.Where(s => s.CompanyId == company && s.Workflow == flow);
        // Keep this base query independent: packing reads derive shipments from allocations below.
        var allocations = db.Allocations.Where(a => a.CompanyId == company && a.Active);
        IQueryable<Carton> cartons = db.Cartons.Where(c => c.CompanyId == company && manifests.Any(m => m.Id == c.ManifestId));
        switch (kind)
        {
            case "packing":
                if (!await manifests.AnyAsync(m => m.Id == id)) throw new RuleException("Packing list not found in this workflow.", 404);
                cartons = cartons.Where(c => c.ManifestId == id);
                shipments = shipments.Where(s => allocations.Any(a => a.ShipmentId == s.Id && cartons.Any(c => c.Id == a.CartonId)));
                break;
            case "trip":
                if (!await db.Trips.AnyAsync(t => t.CompanyId == company && t.Workflow == flow && t.Id == id)) throw new RuleException("Trip not found in this workflow.", 404);
                shipments = shipments.Where(s => s.TripId == id);
                cartons = cartons.Where(c => allocations.Any(a => a.CartonId == c.Id && shipments.Any(s => s.Id == a.ShipmentId)));
                break;
            case "shipment":
                if (!await shipments.AnyAsync(s => s.Id == id)) throw new RuleException("Shipment not found.", 404);
                shipments = shipments.Where(s => s.Id == id);
                cartons = cartons.Where(c => allocations.Any(a => a.CartonId == c.Id && a.ShipmentId == id));
                break;
            default:
                throw new RuleException("Choose a packing list, trip, or shipment.");
        }
        var total = await cartons.CountAsync();
        var skip = Math.Clamp(page ?? 0, 0, 100000) * 500;
        var cartonRows = await cartons.OrderBy(c => c.Id).Skip(skip).Take(500).ToListAsync();
        var shipmentRows = await shipments.ToListAsync();
        var shipmentIds = shipmentRows.Select(s => s.Id).ToArray();
        var tripIds = shipmentRows.Select(s => s.TripId).Concat(kind == "trip" ? [id] : Array.Empty<string>()).Distinct().ToArray();
        var manifestIds = await cartons.Select(c => c.ManifestId).Distinct().ToArrayAsync();
        if (kind == "packing") manifestIds = manifestIds.Append(id).Distinct().ToArray();
        var billingRows = await db.Billings.Where(b => b.CompanyId == company && shipmentIds.Contains(b.ShipmentId)).ToListAsync();
        var jobRows = await db.Jobs.Where(j => j.CompanyId == company && shipmentIds.Contains(j.ShipmentId)).ToListAsync();
        var returnRows = await db.Returns.Where(r => r.CompanyId == company && (kind == "packing" ? cartons.Any(c => c.Id == r.CartonId) : shipmentIds.Contains(r.ShipmentId))).ToListAsync();
        var cartonIds = await cartons.Select(c => c.Id).ToArrayAsync();
        var cartonTokens = cartonIds.Select(Json.Write).ToArray();
        var labelRows = await db.Labels.FromSqlInterpolated($"""
            SELECT * FROM "Labels" AS l WHERE l."CompanyId" = {company}
            AND EXISTS (SELECT 1 FROM unnest({cartonTokens}) AS t(token) WHERE strpos(l."CartonSnapshots", t.token) > 0)
            ORDER BY l."CreatedAt" DESC LIMIT 100
            """).ToListAsync();
        var eventIds = cartonIds.Concat(manifestIds).Concat(tripIds).Concat(shipmentIds)
            .Concat(labelRows.Select(x => x.Id)).Concat(billingRows.Select(x => x.Id)).Concat(jobRows.Select(x => x.Id)).Concat(returnRows.Select(x => x.Id)).Distinct().ToArray();
        var eventTokens = eventIds.Select(Json.Write).ToArray();
        var auditRows = await db.Audit.FromSqlInterpolated($"""
            SELECT * FROM "Audit" AS a WHERE a."CompanyId" = {company}
            AND (a."EntityId" = ANY({eventIds}) OR EXISTS (SELECT 1 FROM unnest({eventTokens}) AS t(token) WHERE strpos(a."Data", t.token) > 0))
            ORDER BY a."At" DESC LIMIT 80
            """).ToListAsync();
        return Results.Ok(new
        {
            workflow = flow,
            orders = await db.Orders.Where(o => o.CompanyId == company && o.Workflow == flow && (shipments.Any(s => s.OrderId == o.Id) || manifests.Any(m => manifestIds.Contains(m.Id) && m.OrderId == o.Id))).ToListAsync(),
            cartons = cartonRows,
            cartonTotal = total,
            hasMore = skip + cartonRows.Count < total,
            shipments = shipmentRows,
            trips = await db.Trips.Where(t => t.CompanyId == company && tripIds.Contains(t.Id)).ToListAsync(),
            manifests = await db.Manifests.Where(m => m.CompanyId == company && manifestIds.Contains(m.Id)).ToListAsync(),
            allocations = await allocations.Where(a => shipmentIds.Contains(a.ShipmentId)).ToListAsync(),
            billings = billingRows,
            jobs = jobRows,
            returns = returnRows,
            labels = labelRows,
            audit = auditRows,
        });
    }
}
