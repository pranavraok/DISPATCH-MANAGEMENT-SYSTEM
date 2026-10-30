using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Dispatch.Migrations;

[DbContext(typeof(DispatchDb))]
[Migration("20261030190000_ElectroGroupBranding")]
public class ElectroGroupBranding : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM "Companies" WHERE "Id" = 'demo' AND "Name" IN ('KR Vishwanath Agarbatti Works · Demo', 'KR Vishwanath Agarbatti Works')) THEN
            UPDATE "Companies" SET "Name" = 'Electro Group of Industries' WHERE "Id" = 'demo';
            UPDATE "Warehouses" SET "Name" = 'Main warehouse' WHERE "CompanyId" = 'demo' AND "Id" = 'main' AND "Name" = 'Timber Layout';
            UPDATE "Products" SET "Name" = 'Sample item A' WHERE "CompanyId" = 'demo' AND "Id" = 'sandal' AND "Name" = 'Sandal' AND "TallyId" IS NULL;
            UPDATE "Products" SET "Name" = 'Sample item B' WHERE "CompanyId" = 'demo' AND "Id" = 'rose' AND "Name" = 'Rose' AND "TallyId" IS NULL;
            INSERT INTO "Audit" ("Id", "CompanyId", "ActorId", "Action", "EntityId", "Data", "At")
              VALUES ('electro-group-branding-20261030', 'demo', 'system', 'CompanyBrandingUpdated', 'demo', '{"company":"Electro Group of Industries","business":"Electrotech Services","recordsPreserved":true}', CURRENT_TIMESTAMP);
          END IF;
          UPDATE "Users" SET "Email" = 'admin@electrogroup.test' WHERE "CompanyId" = 'demo' AND "Id" = 'admin' AND "Email" = 'admin@kriyantha.test' AND NOT EXISTS (SELECT 1 FROM "Users" WHERE "Email" = 'admin@electrogroup.test');
          UPDATE "Users" SET "Email" = 'md@electrogroup.test' WHERE "CompanyId" = 'demo' AND "Id" = 'md' AND "Email" = 'md@kriyantha.test' AND NOT EXISTS (SELECT 1 FROM "Users" WHERE "Email" = 'md@electrogroup.test');
        END $$;
        """);

    // Business identity is a confirmed correction; a rollback must not restore the wrong company.
    protected override void Down(MigrationBuilder migrationBuilder) { }
}
