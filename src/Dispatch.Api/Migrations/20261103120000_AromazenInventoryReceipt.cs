using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Dispatch.Migrations;

[DbContext(typeof(DispatchDb))]
[Migration("20261103120000_AromazenInventoryReceipt")]
public class AromazenInventoryReceipt : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        ALTER TABLE "Cartons" DROP CONSTRAINT carton_state;
        ALTER TABLE "Cartons" ADD CONSTRAINT carton_state CHECK ("State" IN ('PendingReceipt','PendingApproval','Available','Reserved','Loaded','Departed','Retired','Quarantine'));
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        UPDATE "Cartons" SET "State" = 'Available', "Verified" = FALSE WHERE "State" IN ('PendingReceipt','PendingApproval');
        ALTER TABLE "Cartons" DROP CONSTRAINT carton_state;
        ALTER TABLE "Cartons" ADD CONSTRAINT carton_state CHECK ("State" IN ('Available','Reserved','Loaded','Departed','Retired','Quarantine'));
        """);
}
