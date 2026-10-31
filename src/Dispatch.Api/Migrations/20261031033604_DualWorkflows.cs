using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dispatch.Api.Migrations
{
    /// <inheritdoc />
    public partial class DualWorkflows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Workflow",
                table: "Trips",
                type: "text",
                nullable: false,
                defaultValue: "StockFirst");

            migrationBuilder.AddColumn<string>(
                name: "OrderId",
                table: "Shipments",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Workflow",
                table: "Shipments",
                type: "text",
                nullable: false,
                defaultValue: "StockFirst");

            migrationBuilder.AddColumn<string>(
                name: "OrderId",
                table: "Manifests",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Workflow",
                table: "Manifests",
                type: "text",
                nullable: false,
                defaultValue: "StockFirst");

            migrationBuilder.AddColumn<string>(
                name: "Workflow",
                table: "Labels",
                type: "text",
                nullable: false,
                defaultValue: "StockFirst");

            migrationBuilder.AddColumn<string>(
                name: "Workflow",
                table: "Audit",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Orders",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Workflow = table.Column<string>(type: "text", nullable: false, defaultValue: "StockFirst"),
                    Reference = table.Column<string>(type: "text", nullable: false),
                    CustomerId = table.Column<string>(type: "text", nullable: false),
                    WarehouseId = table.Column<string>(type: "text", nullable: false),
                    Destination = table.Column<string>(type: "text", nullable: false),
                    ExpectedCartons = table.Column<int>(type: "integer", nullable: false),
                    Lines = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Orders", x => x.Id);
                    table.UniqueConstraint("AK_Orders_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.CheckConstraint("order_cartons", "\"ExpectedCartons\" BETWEEN 1 AND 10000");
                    table.CheckConstraint("order_workflow", "\"Workflow\" IN ('StockFirst','OrderFirst')");
                    table.ForeignKey(
                        name: "FK_Orders_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Orders_Customers_CompanyId_CustomerId",
                        columns: x => new { x.CompanyId, x.CustomerId },
                        principalTable: "Customers",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Orders_Warehouses_CompanyId_WarehouseId",
                        columns: x => new { x.CompanyId, x.WarehouseId },
                        principalTable: "Warehouses",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Trips_CompanyId_Workflow_CreatedAt",
                table: "Trips",
                columns: new[] { "CompanyId", "Workflow", "CreatedAt" });

            migrationBuilder.AddCheckConstraint(
                name: "trip_workflow",
                table: "Trips",
                sql: "\"Workflow\" IN ('StockFirst','OrderFirst')");

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CompanyId_OrderId",
                table: "Shipments",
                columns: new[] { "CompanyId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CompanyId_Workflow",
                table: "Shipments",
                columns: new[] { "CompanyId", "Workflow" });

            migrationBuilder.AddCheckConstraint(
                name: "shipment_order_required",
                table: "Shipments",
                sql: "\"Workflow\" = 'StockFirst' OR \"OrderId\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "shipment_workflow",
                table: "Shipments",
                sql: "\"Workflow\" IN ('StockFirst','OrderFirst')");

            migrationBuilder.CreateIndex(
                name: "IX_Manifests_CompanyId_OrderId",
                table: "Manifests",
                columns: new[] { "CompanyId", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_Manifests_CompanyId_Workflow_CreatedAt",
                table: "Manifests",
                columns: new[] { "CompanyId", "Workflow", "CreatedAt" });

            migrationBuilder.AddCheckConstraint(
                name: "manifest_order_required",
                table: "Manifests",
                sql: "\"Workflow\" = 'StockFirst' OR \"OrderId\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "manifest_workflow",
                table: "Manifests",
                sql: "\"Workflow\" IN ('StockFirst','OrderFirst')");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_CompanyId_CustomerId",
                table: "Orders",
                columns: new[] { "CompanyId", "CustomerId" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_CompanyId_Id",
                table: "Orders",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_CompanyId_WarehouseId",
                table: "Orders",
                columns: new[] { "CompanyId", "WarehouseId" });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_CompanyId_Workflow_Reference",
                table: "Orders",
                columns: new[] { "CompanyId", "Workflow", "Reference" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Manifests_Orders_CompanyId_OrderId",
                table: "Manifests",
                columns: new[] { "CompanyId", "OrderId" },
                principalTable: "Orders",
                principalColumns: new[] { "CompanyId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Shipments_Orders_CompanyId_OrderId",
                table: "Shipments",
                columns: new[] { "CompanyId", "OrderId" },
                principalTable: "Orders",
                principalColumns: new[] { "CompanyId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Manifests_Orders_CompanyId_OrderId",
                table: "Manifests");

            migrationBuilder.DropForeignKey(
                name: "FK_Shipments_Orders_CompanyId_OrderId",
                table: "Shipments");

            migrationBuilder.DropTable(
                name: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Trips_CompanyId_Workflow_CreatedAt",
                table: "Trips");

            migrationBuilder.DropCheckConstraint(
                name: "trip_workflow",
                table: "Trips");

            migrationBuilder.DropIndex(
                name: "IX_Shipments_CompanyId_OrderId",
                table: "Shipments");

            migrationBuilder.DropIndex(
                name: "IX_Shipments_CompanyId_Workflow",
                table: "Shipments");

            migrationBuilder.DropCheckConstraint(
                name: "shipment_order_required",
                table: "Shipments");

            migrationBuilder.DropCheckConstraint(
                name: "shipment_workflow",
                table: "Shipments");

            migrationBuilder.DropIndex(
                name: "IX_Manifests_CompanyId_OrderId",
                table: "Manifests");

            migrationBuilder.DropIndex(
                name: "IX_Manifests_CompanyId_Workflow_CreatedAt",
                table: "Manifests");

            migrationBuilder.DropCheckConstraint(
                name: "manifest_order_required",
                table: "Manifests");

            migrationBuilder.DropCheckConstraint(
                name: "manifest_workflow",
                table: "Manifests");

            migrationBuilder.DropColumn(
                name: "Workflow",
                table: "Trips");

            migrationBuilder.DropColumn(
                name: "OrderId",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "Workflow",
                table: "Shipments");

            migrationBuilder.DropColumn(
                name: "OrderId",
                table: "Manifests");

            migrationBuilder.DropColumn(
                name: "Workflow",
                table: "Manifests");

            migrationBuilder.DropColumn(
                name: "Workflow",
                table: "Labels");

            migrationBuilder.DropColumn(
                name: "Workflow",
                table: "Audit");
        }
    }
}
