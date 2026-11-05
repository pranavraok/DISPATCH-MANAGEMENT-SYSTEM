using Microsoft.EntityFrameworkCore;
namespace Dispatch;
public sealed partial class Operations
{
    public async Task<object> ReadDashboard(User user)
    {
        Check(Aromazen && user.CompanyId == deployment.Site!.CompanyId, "Dashboard unavailable.", 403);
        var c=user.CompanyId;
        var inventory=await ReadPackedInventory(user);
        var productNames=await db.Products.Where(p=>p.CompanyId==c).ToDictionaryAsync(p=>p.Sku,p=>p.Name);
        var active=db.Shipments.Where(s=>s.CompanyId==c && s.Workflow==Workflows.StockFirst && s.State!="Cancelled" && s.State!="Departed" && db.Orders.Any(o=>o.CompanyId==c && o.Id==s.OrderId && o.State=="Open"));
        var scanning=active.Where(s=>!s.LoadApproved);
        var bills=active.Where(s=>s.LoadApproved && !db.Billings.Any(b=>b.CompanyId==c && b.ShipmentId==s.Id && b.Revision==s.BillingVersion && b.Approved));
        var ready=active.Where(s=>s.LoadApproved && s.InvoiceJobId==null && db.Billings.Any(b=>b.CompanyId==c && b.ShipmentId==s.Id && b.Revision==s.BillingVersion && b.Approved));
        var issueStates=new[]{"Blocked","ConfirmationUnknown","Rejected","NeedsReview"};
        var issues=active.Where(s=>db.Jobs.Any(j=>j.CompanyId==c && j.Id==s.InvoiceJobId && issueStates.Contains(j.State)));
        async Task<object[]> Tasks(IQueryable<Shipment> query) => (await query.OrderBy(s=>s.Id).Take(5).Select(s=>new {
            shipmentId=s.Id,
            customer=db.Customers.Where(customer=>customer.CompanyId==c && customer.Id==s.CustomerId).Select(customer=>customer.Name).FirstOrDefault(),
            reference=db.Orders.Where(o=>o.CompanyId==c && o.Id==s.OrderId).Select(o=>o.Reference).FirstOrDefault()
        }).ToArrayAsync()).Cast<object>().ToArray();
        var connectors=await db.Connectors.Where(connector=>connector.CompanyId==c && !connector.Revoked).OrderByDescending(connector=>connector.LastSeen).ToListAsync();
        var mapping=await db.Mappings.SingleAsync(m=>m.CompanyId==c);
        var exact=connectors.Where(connector=>connector.ExpectedCompany==mapping.ExpectedCompany).ToArray();
        var connected=exact.Any(connector=>connector.LastSeen>DateTimeOffset.UtcNow.AddMinutes(-4) && Json.Read<System.Text.Json.JsonElement>(connector.Diagnostics).TryGetProperty("tallyReachable",out var reachable) && reachable.ValueKind==System.Text.Json.JsonValueKind.True);
        return new {
            inventory=new { inventory.AvailableCartons, inventory.PendingLabels, inventory.HeldCartons, inventory.LoadedCartons, products=inventory.Products.Select(p=>new { p.Sku, name=productNames.GetValueOrDefault(p.Sku,p.Sku), p.Unit, p.Quantity, p.Cartons }) },
            pending=new {
                dispatches=new { count=await scanning.CountAsync(), items=await Tasks(scanning) },
                bills=new { count=await bills.CountAsync(), items=await Tasks(bills) },
                readyInvoices=new { count=await ready.CountAsync(), items=await Tasks(ready) },
                tallyIssues=new { count=await issues.CountAsync(), items=await Tasks(issues) }
            },
            tally=new { status=connectors.Count==0 ? "Setup required" : connected ? "Connected" : "Disconnected", invoiceSetupReady=mapping.ContractValidated, lastSync=exact.Where(connector=>connector.MastersSyncedAt!=null).Select(connector=>connector.MastersSyncedAt).DefaultIfEmpty().Max() },
            recent=await ReadDispatchHistory(user,null,null,0), updatedAt=DateTimeOffset.UtcNow
        };
    }
}
