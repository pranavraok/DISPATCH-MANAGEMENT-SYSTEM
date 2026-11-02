using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Dispatch.Migrations;

[DbContext(typeof(DispatchDb))]
[Migration("20261101150000_TallyProductSellingPrice")]
public sealed class TallyProductSellingPrice : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<decimal>(
            name: "TallySellingPrice",
            table: "Products",
            type: "numeric(20,6)",
            precision: 20,
            scale: 6,
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "TallySellingPrice", table: "Products");
    }
}
