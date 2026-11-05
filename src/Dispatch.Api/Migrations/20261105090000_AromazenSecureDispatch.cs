using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace Dispatch.Migrations;
[DbContext(typeof(DispatchDb))]
[Migration("20261105090000_AromazenSecureDispatch")]
public class AromazenSecureDispatch : Migration
{
    protected override void Up(MigrationBuilder m) => m.Sql("""
        CREATE TABLE "AromazenQrKeys" ("CompanyId" text PRIMARY KEY REFERENCES "Companies"("Id"), "Secret" text NOT NULL);
        CREATE TABLE "AromazenQrLabels" ("Token" text PRIMARY KEY, "CompanyId" text NOT NULL REFERENCES "Companies"("Id"), "CartonId" text NOT NULL, "Revision" integer NOT NULL, UNIQUE ("CompanyId", "CartonId", "Revision"), FOREIGN KEY ("CompanyId", "CartonId") REFERENCES "Cartons"("CompanyId", "Id"));
        CREATE TABLE "AromazenDevices" ("Id" text PRIMARY KEY, "CompanyId" text NOT NULL REFERENCES "Companies"("Id"), "UserId" text NOT NULL, "Name" text NOT NULL, "SecretHash" text NOT NULL UNIQUE, "State" text NOT NULL DEFAULT 'Pending' CHECK ("State" IN ('Pending','Approved','Revoked')), "CreatedAt" timestamptz NOT NULL DEFAULT now(), "ApprovedBy" text, FOREIGN KEY ("CompanyId", "UserId") REFERENCES "Users"("CompanyId", "Id"));
        """);
    protected override void Down(MigrationBuilder m) => m.Sql("""DROP TABLE "AromazenDevices"; DROP TABLE "AromazenQrLabels"; DROP TABLE "AromazenQrKeys";""");
}
