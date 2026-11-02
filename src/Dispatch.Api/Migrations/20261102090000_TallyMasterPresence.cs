using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Dispatch.Migrations;

[DbContext(typeof(DispatchDb))]
[Migration("20261102090000_TallyMasterPresence")]
public sealed class TallyMasterPresence : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(name: "InTally", table: "Products", type: "boolean", nullable: false, defaultValue: true);
        migrationBuilder.AddColumn<bool>(name: "InTally", table: "Customers", type: "boolean", nullable: false, defaultValue: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "InTally", table: "Products");
        migrationBuilder.DropColumn(name: "InTally", table: "Customers");
    }
}
