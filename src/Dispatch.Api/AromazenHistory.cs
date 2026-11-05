using Microsoft.EntityFrameworkCore;
namespace Dispatch;
public sealed partial class Operations
{
    public async Task<object> ReadDispatchHistory(User user, string? search, string? status, int page)
    {
        Check(Aromazen && user.CompanyId == deployment.Site!.CompanyId, "History unavailable.", 403);
        var c=user.CompanyId;
        var stages=db.Shipments.Where(s=>s.CompanyId==c && s.Workflow==Workflows.StockFirst).Select(s=>new {
            shipment=s,
            stage=s.State=="Cancelled" ? "Cancelled" : db.Jobs.Any(j=>j.CompanyId==c && j.ShipmentId==s.Id && j.State=="Confirmed") ? "Invoice confirmed" : db.Jobs.Any(j=>j.CompanyId==c && j.ShipmentId==s.Id && j.State!="Retired") ? "Tally pending" : s.LoadApproved ? "Review bill" : "Scanning",
            scannedCartons=db.Allocations.Count(a=>a.CompanyId==c && a.ShipmentId==s.Id && a.Active && (a.State=="Loaded" || a.State=="Departed"))
        });
        var orders=db.Orders.Where(o=>o.CompanyId==c && o.Workflow==Workflows.StockFirst);
        if (!string.IsNullOrWhiteSpace(search)) {
            var term=search.Trim().ToLowerInvariant();
            orders=orders.Where(o=>o.Reference.ToLower().Contains(term) || o.Destination.ToLower().Contains(term) || db.Customers.Any(customer=>customer.CompanyId==c && customer.Id==o.CustomerId && customer.Name.ToLower().Contains(term)));
        }
        if (status=="Cancelled") orders=orders.Where(o=>o.State=="Cancelled");
        else if (!string.IsNullOrWhiteSpace(status) && status!="All") orders=orders.Where(o=>o.State!="Cancelled" && stages.Any(s=>s.shipment.OrderId==o.Id && s.stage==status));
        var total=await orders.CountAsync();
        var rows=await orders.OrderByDescending(o=>o.CreatedAt).ThenBy(o=>o.Id).Skip(Math.Clamp(page,0,100000)*20).Take(20).ToListAsync();
        var customerIds=rows.Select(o=>o.CustomerId).Distinct().ToArray();
        var customerNames=await db.Customers.Where(customer=>customer.CompanyId==c && customerIds.Contains(customer.Id)).ToDictionaryAsync(customer=>customer.Id,customer=>customer.Name);
        var orderIds=rows.Select(o=>o.Id).ToArray();
        var shipments=await stages.Where(s=>orderIds.Contains(s.shipment.OrderId!)).ToListAsync();
        var shipmentIds=shipments.Select(s=>s.shipment.Id).ToArray();
        var bills=await db.Billings.Where(b=>b.CompanyId==c && shipmentIds.Contains(b.ShipmentId) && db.Shipments.Any(s=>s.CompanyId==c && s.Id==b.ShipmentId && s.BillingVersion==b.Revision)).ToListAsync();
        return new { total, page, orders=rows.Select(order=>new { order, customerName=customerNames.GetValueOrDefault(order.CustomerId, order.CustomerId), shipments=shipments.Where(s=>s.shipment.OrderId==order.Id).Select(s=> {
            var bill=bills.SingleOrDefault(b=>b.ShipmentId==s.shipment.Id && b.Revision==s.shipment.BillingVersion);
            return new { s.shipment, s.stage, s.scannedCartons, billTotal=bill?.Total, lines=bill==null ? (object)Array.Empty<object>() : Json.Read<System.Text.Json.JsonElement>(bill.Snapshot).GetProperty("lines") };
        }) }) };
    }
}
