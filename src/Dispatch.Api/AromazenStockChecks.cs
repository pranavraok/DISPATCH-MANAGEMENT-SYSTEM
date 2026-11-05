using System.Text.Json;
using Microsoft.EntityFrameworkCore;
namespace Dispatch;
public sealed partial class Operations
{
 async Task<StockCheckRow> GetStockCheck(string id) {
  var row=await db.Database.SqlQuery<StockCheckRow>($"""SELECT "Id","ActorId","Name","Expected","Scanned","StartedAt","FinishedAt" FROM "AromazenStockChecks" WHERE "CompanyId"={company} AND "Id"={id}""").SingleOrDefaultAsync();
  Check(row!=null,"Stock check unavailable.",404);return row!;
 }
 async Task<object> BeginStockCheck(JsonElement d) {
  RequireAromazen();Permissions.Require(actor,"PackingSupervisor","DispatchSupervisor");var name=Str(d,"name");Check(name.Length is >=3 and <=80,"Give this stock check a short name.");
  Check(await db.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM "AromazenStockChecks" WHERE "CompanyId"={company} AND "ActorId"={actor.Id} AND "FinishedAt" IS NULL""").SingleAsync()<5,"Finish an earlier stock check first.");
  var expected=await db.Cartons.Where(c=>c.CompanyId==company && c.State=="Available" && !c.Held && db.Manifests.Any(m=>m.CompanyId==company && m.Id==c.ManifestId && m.Workflow==Workflows.StockFirst)).OrderBy(c=>c.Id).Select(c=>c.Id).Take(100001).ToArrayAsync();
  Check(expected.Length<=100000,"Split large stock checks into warehouse-level counts before exceeding 100,000 cartons.");
  var id=NewId("SC-");var json=Json.Write(expected);
  await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "AromazenStockChecks" ("Id","CompanyId","ActorId","Name","Expected") VALUES ({id},{company},{actor.Id},{name},{json})""");
  return new {id,expected=expected.Length,message="Stock check started. Scanning here never dispatches cartons or changes stock."};
 }
 async Task<object> ScanStockCheck(JsonElement d) {
  RequireAromazen();Permissions.Require(actor,"PackingSupervisor","DispatchSupervisor");var check=await GetStockCheck(Str(d,"id"));Check(check.ActorId==actor.Id && check.FinishedAt==null,"This stock check belongs to another operator or is finished.",409);
  var carton=await ResolveQr(Str(d,"qr"));var scanned=Json.Read<string[]>(check.Scanned).ToHashSet();if(!scanned.Add(carton.Id))return new {outcome="Duplicate",message="Already counted. Totals unchanged."};
  var expected=Json.Read<string[]>(check.Expected).Contains(carton.Id);var json=Json.Write(scanned);
  await db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "AromazenStockChecks" SET "Scanned"={json} WHERE "CompanyId"={company} AND "Id"={check.Id}""");
  return new {outcome=expected?"Counted":"Unexpected",cartonId=carton.Id,message=expected?"Carton counted. Inventory unchanged.":"Counted as unexpected: this carton was not ready stock when the check started. Ask a supervisor to review."};
 }
 async Task<object> FinishStockCheck(JsonElement d) {
  RequireAromazen();Permissions.Require(actor,"PackingSupervisor","DispatchSupervisor");var check=await GetStockCheck(Str(d,"id"));Check(check.ActorId==actor.Id && check.FinishedAt==null,"Stock check already finished or belongs to another operator.",409);
  await db.Database.ExecuteSqlInterpolatedAsync($"""UPDATE "AromazenStockChecks" SET "FinishedAt"=now() WHERE "CompanyId"={company} AND "Id"={check.Id}""");return new {message="Stock check saved. Review differences; no automatic stock adjustment was made."};
 }
 public async Task<object> ReadStockChecks(User user,string? id) {
  actor=user;company=user.CompanyId;workflow=Workflows.StockFirst;RequireAromazen();
  if(string.IsNullOrEmpty(id))return await db.Database.SqlQuery<StockCheckRow>($"""SELECT "Id","ActorId","Name",'[]' AS "Expected",'[]' AS "Scanned","StartedAt","FinishedAt" FROM "AromazenStockChecks" WHERE "CompanyId"={company} ORDER BY "StartedAt" DESC LIMIT 30""").ToArrayAsync();
  var check=await GetStockCheck(id);var expected=Json.Read<string[]>(check.Expected).ToHashSet();var scanned=Json.Read<string[]>(check.Scanned).ToHashSet();var missing=expected.Except(scanned).ToArray();var unexpected=scanned.Except(expected).ToArray();
  var reportIds=missing.Take(50).Concat(unexpected.Take(50)).Distinct().ToArray();var cartons=await db.Cartons.Where(c=>c.CompanyId==company && reportIds.Contains(c.Id)).Select(c=>new {c.Id,c.Marking,c.State}).ToArrayAsync();
  var changed=await db.Cartons.Where(c=>c.CompanyId==company && expected.Contains(c.Id) && (c.State!="Available" || c.Held)).CountAsync();
  return new {check.Id,check.Name,check.ActorId,check.StartedAt,check.FinishedAt,expected=expected.Count,scanned=scanned.Count,missing=missing.Length,unexpected=unexpected.Length,changedSinceStart=changed,differences=cartons.Select(c=>new {c.Id,c.Marking,c.State,kind=missing.Contains(c.Id)?"Missing":"Unexpected"}),reportLimited=missing.Length>50||unexpected.Length>50};
 }
 public async Task<byte[]> ExportStockCheck(User user,string id) {
  actor=user;company=user.CompanyId;workflow=Workflows.StockFirst;RequireAromazen();var check=await GetStockCheck(id);
  var expected=Json.Read<string[]>(check.Expected).ToHashSet();var scanned=Json.Read<string[]>(check.Scanned).ToHashSet();var missing=expected.Except(scanned).ToHashSet();var unexpected=scanned.Except(expected).ToHashSet();var ids=missing.Concat(unexpected).ToArray();
  var cartons=await db.Cartons.Where(c=>c.CompanyId==company && ids.Contains(c.Id)).ToDictionaryAsync(c=>c.Id);
  static string Cell(string value) { if(value.TrimStart().Length>0 && "=+-@".Contains(value.TrimStart()[0]))value="'"+value;return "\""+value.Replace("\"","\"\"")+"\""; }
  var csv=new System.Text.StringBuilder("\uFEFFKind,Carton ID,Marking,Current status\r\n");
  foreach(var cartonId in ids.OrderBy(value=>value)){cartons.TryGetValue(cartonId,out var carton);csv.AppendLine(string.Join(",",new[]{missing.Contains(cartonId)?"Missing":"Unexpected",cartonId,carton?.Marking??"Unavailable record",carton?.State??"Unavailable"}.Select(Cell)));}
  return System.Text.Encoding.UTF8.GetBytes(csv.ToString());
 }

}
