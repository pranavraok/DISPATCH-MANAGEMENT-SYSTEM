using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Dispatch.Migrations;

[DbContext(typeof(DispatchDb))]
[Migration("20261104140000_AromazenQrInventory")]
public class AromazenQrInventory : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        ALTER TABLE "Cartons" DROP CONSTRAINT carton_state;
        ALTER TABLE "Cartons" ADD CONSTRAINT carton_state CHECK ("State" IN ('PendingLabel','PendingReceipt','PendingApproval','Available','Reserved','Loaded','Departed','Retired','Quarantine'));
        UPDATE "Cartons" c SET "State" = CASE
          WHEN (c."State" = 'Available' AND c."Attached" AND c."Verified") OR EXISTS (
            SELECT 1 FROM "Labels" l
            CROSS JOIN LATERAL jsonb_array_elements(l."CartonSnapshots"::jsonb) s
            WHERE l."CompanyId" = c."CompanyId" AND s->>'id' = c."Id"
              AND (s->>'revision')::int = c."Revision"
          ) THEN 'Available' ELSE 'PendingLabel' END
        WHERE c."CompanyId" = 'aromazon-india' AND c."State" IN ('PendingReceipt','PendingApproval','Available')
          AND NOT EXISTS (SELECT 1 FROM "Allocations" a WHERE a."CompanyId" = c."CompanyId" AND a."CartonId" = c."Id" AND a."Active");
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        UPDATE "Cartons" SET "State" = 'PendingReceipt' WHERE "State" = 'PendingLabel';
        ALTER TABLE "Cartons" DROP CONSTRAINT carton_state;
        ALTER TABLE "Cartons" ADD CONSTRAINT carton_state CHECK ("State" IN ('PendingReceipt','PendingApproval','Available','Reserved','Loaded','Departed','Retired','Quarantine'));
        """);
}
