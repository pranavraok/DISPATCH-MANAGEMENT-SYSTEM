using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace Dispatch.Migrations;
[DbContext(typeof(DispatchDb))]
[Migration("20261105100000_AromazenProductivity")]
public class AromazenProductivity : Migration
{
 protected override void Up(MigrationBuilder m)=>m.Sql("""
 CREATE TABLE "AromazenPackingPresets" ("Id" text PRIMARY KEY, "CompanyId" text NOT NULL REFERENCES "Companies"("Id"), "Name" text NOT NULL, "Groups" text NOT NULL, "Active" boolean NOT NULL DEFAULT TRUE, "UpdatedAt" timestamptz NOT NULL DEFAULT now());
 CREATE UNIQUE INDEX aromazen_preset_name ON "AromazenPackingPresets" ("CompanyId", lower("Name")) WHERE "Active";
 CREATE TABLE "AromazenProductionBatches" ("CompanyId" text NOT NULL REFERENCES "Companies"("Id"), "CartonId" text NOT NULL, "Revision" integer NOT NULL, "Sku" text NOT NULL, "Batch" text NOT NULL, PRIMARY KEY ("CompanyId","CartonId","Revision","Sku"));
 CREATE INDEX aromazen_production_batch ON "AromazenProductionBatches" ("CompanyId",lower("Batch"));
 CREATE TABLE "AromazenStockChecks" ("Id" text PRIMARY KEY, "CompanyId" text NOT NULL REFERENCES "Companies"("Id"), "ActorId" text NOT NULL, "Name" text NOT NULL, "Expected" text NOT NULL, "Scanned" text NOT NULL DEFAULT '[]', "StartedAt" timestamptz NOT NULL DEFAULT now(), "FinishedAt" timestamptz);
 """);
 protected override void Down(MigrationBuilder m)=>m.Sql("""DROP TABLE "AromazenStockChecks"; DROP TABLE "AromazenProductionBatches"; DROP TABLE "AromazenPackingPresets";""");
}
