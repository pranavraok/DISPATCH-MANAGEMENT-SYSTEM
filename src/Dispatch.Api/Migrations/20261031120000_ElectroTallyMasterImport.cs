using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Dispatch.Migrations;

[DbContext(typeof(DispatchDb))]
[Migration("20261031120000_ElectroTallyMasterImport")]
public sealed class ElectroTallyMasterImport : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(name: "TallyGroup", table: "Products", type: "text", nullable: true);
        migrationBuilder.AddColumn<string>(name: "HsnCode", table: "Products", type: "text", nullable: true);
        migrationBuilder.AddColumn<decimal>(name: "GstRate", table: "Products", type: "numeric(20,6)", precision: 20, scale: 6, nullable: true);
        migrationBuilder.AddColumn<string>(name: "TallyGroup", table: "Customers", type: "text", nullable: true);
        migrationBuilder.AddColumn<string>(name: "MastersSnapshot", table: "Connectors", type: "text", nullable: false, defaultValue: "{}");
        migrationBuilder.AddColumn<DateTimeOffset>(name: "MastersSyncedAt", table: "Connectors", type: "timestamp with time zone", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "TallyGroup", table: "Products");
        migrationBuilder.DropColumn(name: "HsnCode", table: "Products");
        migrationBuilder.DropColumn(name: "GstRate", table: "Products");
        migrationBuilder.DropColumn(name: "TallyGroup", table: "Customers");
        migrationBuilder.DropColumn(name: "MastersSnapshot", table: "Connectors");
        migrationBuilder.DropColumn(name: "MastersSyncedAt", table: "Connectors");
    }
}
