using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Dispatch;
public sealed class PackingPresetRow { public string Id {get;set;}=""; public string Name {get;set;}=""; public string Groups {get;set;}="[]"; public DateTimeOffset UpdatedAt {get;set;} }
public sealed class ProductionBatchRow { public string CartonId {get;set;}=""; public int Revision {get;set;} public string Sku {get;set;}=""; public string Batch {get;set;}=""; }
public sealed class StockCheckRow { public string Id {get;set;}=""; public string ActorId {get;set;}=""; public string Name {get;set;}=""; public string Expected {get;set;}="[]"; public string Scanned {get;set;}="[]"; public DateTimeOffset StartedAt {get;set;} public DateTimeOffset? FinishedAt {get;set;} }
public record SuggestCartons(string WarehouseId,string? CustomerId,ContentLine[] Lines);
public sealed partial class Operations
{
 public async Task<object> ReadPackingPresets(User user) {
  Check(Aromazen && user.CompanyId==deployment.Site!.CompanyId,"Unavailable.",403);
  return await db.Database.SqlQuery<PackingPresetRow>($"""SELECT "Id","Name","Groups","UpdatedAt" FROM "AromazenPackingPresets" WHERE "CompanyId"={user.CompanyId} AND "Active" ORDER BY "Name" LIMIT 100""").ToArrayAsync();
 }
 async Task<object> SavePackingPreset(JsonElement d) {
  RequireAromazen();Permissions.Require(actor,"PackingClerk","PackingSupervisor");
  var name=Str(d,"name");Check(name.Length is >=2 and <=80,"Give the packing preset a short name.");
  var groups=Json.Read<PackedGroup[]>(d.GetProperty("groups"));await ValidateGroups(groups);
  Check(groups.Sum(g=>(long)g.Count)<=1000,"Use at most 1,000 cartons in a preset.");
  Check(await db.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM "AromazenPackingPresets" WHERE "CompanyId"={company} AND "Active" AND lower("Name")=lower({name})""").SingleAsync()==0,"That preset name exists. Choose another name.",409);
  Check(await db.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM "AromazenPackingPresets" WHERE "CompanyId"={company} AND "Active" """).SingleAsync()<100,"Archive an old preset before adding more.");
  var clean=groups.Select(g=>new PackedGroup(g.Marking,g.Count,g.Lines.Select(l=>new ContentLine(l.Sku,l.Quantity,l.Unit)).ToArray())).ToArray();
  var id=NewId("PP-");var json=Json.Write(clean);
  await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "AromazenPackingPresets" ("Id","CompanyId","Name","Groups") VALUES ({id},{company},{name},{json})""");
  return new { id,message="Packing preset saved. No cartons or inventory were created." };
 }
 async Task<object> ArchivePackingPreset(JsonElement d) {
  RequireAromazen();Permissions.Require(actor,"PackingSupervisor");RequireReason(d);var id=Str(d,"id");
  Check(await db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "AromazenPackingPresets" SET "Active"=false,"UpdatedAt"=now() WHERE "Id"={id} AND "CompanyId"={company} AND "Active" """)==1,"Preset unavailable.",404);
  return new {message="Preset archived. Existing cartons are unchanged."};
 }
 readonly Dictionary<(string Id,int Revision,string Sku),ProductionBatchRow> pendingProductionBatches=new();
 readonly Dictionary<(string Id,int Revision),ProductionBatchRow[]> cachedProductionBatches=new();
 async Task CaptureProductionBatches(Carton carton,JsonElement lines) {
  var skus=Json.Read<ContentLine[]>(carton.Lines).Select(l=>l.Sku).ToHashSet();
  foreach(var line in lines.EnumerateArray()) {
   var batch=Str(line,"productionBatch");if(batch.Length==0)continue;
   var sku=Str(line,"sku");Check(batch.Length<=80 && !batch.Any(char.IsControl),"Manufacturing batch must be at most 80 printable characters.");Check(skus.Contains(sku),"Batch product is not in this carton.");
   var key=(carton.Id,carton.Revision,sku);Check(!pendingProductionBatches.TryGetValue(key,out var previous) || previous.Batch==batch,"Use one manufacturing batch per product in a carton.");
   pendingProductionBatches[key]=new ProductionBatchRow {CartonId=carton.Id,Revision=carton.Revision,Sku=sku,Batch=batch};
  }
  await Task.CompletedTask;
 }
 async Task CopyProductionBatches(Carton source,Carton target,int sourceRevision,ISet<string>? replacedSkus=null) {
  var key=(source.Id,sourceRevision);
  if(!cachedProductionBatches.TryGetValue(key,out var batches)) {
   batches=await db.Database.SqlQuery<ProductionBatchRow>($"""SELECT "CartonId","Revision","Sku","Batch" FROM "AromazenProductionBatches" WHERE "CompanyId"={company} AND "CartonId"={source.Id} AND "Revision"={sourceRevision}""").ToArrayAsync();cachedProductionBatches[key]=batches;
  }
  var skus=Json.Read<ContentLine[]>(target.Lines).Select(l=>l.Sku).ToHashSet();
  foreach(var batch in batches.Where(b=>skus.Contains(b.Sku) && !(replacedSkus?.Contains(b.Sku)??false)))pendingProductionBatches.TryAdd((target.Id,target.Revision,batch.Sku),new ProductionBatchRow {CartonId=target.Id,Revision=target.Revision,Sku=batch.Sku,Batch=batch.Batch});
 }
 async Task FlushProductionBatches() {
  if(pendingProductionBatches.Count==0)return;var json=Json.Write(pendingProductionBatches.Values);
  await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "AromazenProductionBatches" ("CompanyId","CartonId","Revision","Sku","Batch") SELECT {company},x."cartonId",x."revision",x."sku",x."batch" FROM jsonb_to_recordset(CAST({json} AS jsonb)) AS x("cartonId" text,"revision" integer,"sku" text,"batch" text) ON CONFLICT DO NOTHING""");
 }
 public async Task<object> ReadCartonDetails(User user,string id) {
  actor=user;company=user.CompanyId;workflow=Workflows.StockFirst;RequireAromazen();var carton=await Get<Carton>(id);
  var batches=await db.Database.SqlQuery<ProductionBatchRow>($"""SELECT "CartonId","Revision","Sku","Batch" FROM "AromazenProductionBatches" WHERE "CompanyId"={company} AND "CartonId"={id} AND "Revision"={carton.Revision}""").ToArrayAsync();
  return new {carton,productionBatches=batches};
 }
 public async Task<object> SuggestAvailableCartons(User user,SuggestCartons input) {
  actor=user;company=user.CompanyId;workflow=Workflows.StockFirst;RequireAromazen();await Get<Warehouse>(input.WarehouseId);
  if(input.CustomerId!=null)await Get<Customer>(input.CustomerId);
  var lines=await Normalize(input.Lines);Check(lines.Select(l=>l.Sku).Distinct().Count()==lines.Length,"Choose each product once using its base unit.");
  var products=await db.Products.Where(p=>p.CompanyId==company).ToDictionaryAsync(p=>p.Sku);
  Check(lines.All(l=>l.Unit==products[l.Sku].Unit),"Enter requested quantities in the product's base unit.");
  var skus=lines.Select(l=>l.Sku).ToArray();
  var query=from c in db.Cartons join m in db.Manifests on new {c.CompanyId,Id=c.ManifestId} equals new {m.CompanyId,m.Id}
    where c.CompanyId==company && m.Workflow==Workflows.StockFirst && c.State=="Available" && !c.Held && c.WarehouseId==input.WarehouseId && (c.CustomerId==null || c.CustomerId==input.CustomerId) && skus.Any(sku=>c.Lines.Contains(sku))
    orderby m.CreatedAt,c.Id select new {carton=c,packingBatch=m.Name,packedAt=m.CreatedAt};
  var candidates=await query.Take(5001).ToArrayAsync();var remaining=lines.ToDictionary(l=>l.Sku,l=>l.Quantity);var selected=new List<object>();
  var ranked=candidates.Take(5000).Select(candidate=>new {candidate,totals=Json.Read<ContentLine[]>(candidate.carton.Lines).GroupBy(l=>l.Sku).ToDictionary(g=>g.Key,g=>g.Sum(l=>l.BaseQuantity??l.Quantity))}).Where(row=>row.totals.Keys.All(remaining.ContainsKey)).OrderByDescending(row=>row.totals.Count).ThenBy(row=>row.candidate.packedAt).ThenBy(row=>row.candidate.carton.Id);
  foreach(var row in ranked) {
   var candidate=row.candidate;var totals=row.totals;
   if(totals.Any(t=>!remaining.ContainsKey(t.Key) || t.Value>remaining[t.Key]))continue;
   selected.Add(new {candidate.carton.Id,candidate.carton.Marking,candidate.packingBatch,candidate.packedAt,lines=Json.Read<ContentLine[]>(candidate.carton.Lines)});
   foreach(var item in totals)remaining[item.Key]-=item.Value;
   if(remaining.Values.All(v=>v==0))break;
  }
  return new {cartons=selected,remaining=remaining.Select(r=>new {sku=r.Key,quantity=r.Value,unit=products[r.Key].Unit}),complete=remaining.Values.All(v=>v==0),searchLimited=candidates.Length>5000,message="Suggestions only. Stock is not reserved; scan each physical carton to dispatch it. Suitable mixed cartons are considered first, then older cartons. Other combinations may fit better."};
 }
 public async Task<object> TraceProductionBatch(User user,string batch,int page) {
  actor=user;company=user.CompanyId;workflow=Workflows.StockFirst;RequireAromazen();batch=batch.Trim();Check(batch.Length is >=1 and <=80,"Enter a manufacturing batch reference.");
  var matches=db.Database.SqlQuery<ProductionBatchRow>($"""SELECT b."CartonId",b."Revision",b."Sku",b."Batch" FROM "AromazenProductionBatches" b JOIN "Cartons" c ON c."CompanyId"=b."CompanyId" AND c."Id"=b."CartonId" AND c."Revision"=b."Revision" WHERE b."CompanyId"={company} AND lower(b."Batch")=lower({batch})""");
  var ids=matches.Select(b=>b.CartonId).Distinct();var total=await ids.CountAsync();var selectedIds=await ids.OrderBy(id=>id).Skip(Math.Clamp(page,0,100000)*20).Take(20).ToArrayAsync();
  var cartons=await db.Cartons.Where(c=>c.CompanyId==company && selectedIds.Contains(c.Id)).OrderBy(c=>c.Id).ToArrayAsync();
  var matchingRows=await matches.Where(b=>selectedIds.Contains(b.CartonId)).ToArrayAsync();
  var ready=await db.Database.SqlQuery<PackedProductBalance>($"""
   SELECT line->>'sku' AS "Sku",COALESCE(line->>'baseUnit',line->>'unit') AS "Unit",SUM(COALESCE(line->>'baseQuantity',line->>'quantity')::numeric) AS "Quantity",COUNT(DISTINCT c."Id") AS "Cartons"
   FROM "Cartons" c JOIN "AromazenProductionBatches" b ON b."CompanyId"=c."CompanyId" AND b."CartonId"=c."Id" AND b."Revision"=c."Revision"
   CROSS JOIN LATERAL jsonb_array_elements(c."Lines"::jsonb) line
   WHERE c."CompanyId"={company} AND lower(b."Batch")=lower({batch}) AND b."Sku"=line->>'sku' AND c."State"='Available' AND NOT c."Held"
   GROUP BY line->>'sku',COALESCE(line->>'baseUnit',line->>'unit')
   """).ToArrayAsync();
  var readySkus=ready.Select(p=>p.Sku).ToArray();var names=await db.Products.Where(p=>p.CompanyId==company && readySkus.Contains(p.Sku)).ToDictionaryAsync(p=>p.Sku,p=>p.Name);
  var history=await (from a in db.Allocations join s in db.Shipments on a.ShipmentId equals s.Id join customer in db.Customers on s.CustomerId equals customer.Id
    where a.CompanyId==company && s.CompanyId==company && customer.CompanyId==company && selectedIds.Contains(a.CartonId)
    select new {a.CartonId,s.Id,customer=customer.Name,orderReference=db.Orders.Where(o=>o.CompanyId==company && o.Id==s.OrderId).Select(o=>o.Reference).FirstOrDefault(),s.State,invoice=db.Jobs.Where(j=>j.CompanyId==company && j.Id==s.InvoiceJobId && j.State=="Confirmed").Select(j=>j.VoucherReference).FirstOrDefault()}).ToArrayAsync();
  var returns=await db.Returns.Where(r=>r.CompanyId==company && selectedIds.Contains(r.CartonId)).Select(r=>new {r.CartonId,r.State,r.Condition,r.AccountingStatus}).ToArrayAsync();
  return new {batch,total,page,readyProducts=ready.Select(p=>new {p.Sku,name=names.GetValueOrDefault(p.Sku,p.Sku),p.Unit,p.Quantity,p.Cartons}),cartons=cartons.Select(c=>new {carton=c,matchedProducts=Json.Read<ContentLine[]>(c.Lines).Where(l=>matchingRows.Any(b=>b.CartonId==c.Id&&b.Sku==l.Sku)),history=history.Where(h=>h.CartonId==c.Id),returns=returns.Where(r=>r.CartonId==c.Id)})};
 }
 async Task<object> ReopenStockLoad(JsonElement d) {
  RequireAromazen();Permissions.Require(actor,"DispatchSupervisor");RequireReason(d);Check(Flag(d,"physicalConfirmed"),"Confirm that the physical load will be checked again.");
  var shipment=await Get<Shipment>(Str(d,"id"));await EnsureOrderOpenForShipment(shipment);
  Check(shipment.LoadApproved && shipment.State!="Departed" && shipment.InvoiceJobId==null,"This load cannot be reopened. Invoiced/departed shipments need accounting reconciliation.",409);
  Check(!await db.Jobs.AnyAsync(j=>j.CompanyId==company && j.ShipmentId==shipment.Id && j.State!="Rejected" && j.State!="Blocked"),"An invoice is being processed or confirmed. Reconcile it before correcting the load.",409);
  var bill=await db.Billings.SingleOrDefaultAsync(b=>b.CompanyId==company && b.ShipmentId==shipment.Id && b.Revision==shipment.BillingVersion);
  if(bill!=null){bill.Approved=false;bill.ApprovedBy=null;bill.ApprovedAt=null;}
  shipment.LoadApproved=false;shipment.LoadApprovedBy=null;shipment.State="Loading";
  return new {id=shipment.Id,message="Loading reopened for correction. Check the physical cartons, then approve the load and bill again."};
 }

}
