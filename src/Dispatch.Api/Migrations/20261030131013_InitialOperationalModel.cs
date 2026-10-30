using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dispatch.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialOperationalModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Companies",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Environment = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Companies", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Audit",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ActorId = table.Column<string>(type: "text", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    EntityId = table.Column<string>(type: "text", nullable: false),
                    Data = table.Column<string>(type: "text", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Audit", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Audit_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Connectors",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    SecretHash = table.Column<string>(type: "text", nullable: false),
                    Revoked = table.Column<bool>(type: "boolean", nullable: false),
                    ExpectedCompany = table.Column<string>(type: "text", nullable: false),
                    Environment = table.Column<string>(type: "text", nullable: false),
                    LastSeen = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Diagnostics = table.Column<string>(type: "text", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Connectors", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Connectors_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Conversions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ProductId = table.Column<string>(type: "text", nullable: false),
                    FromUnit = table.Column<string>(type: "text", nullable: false),
                    BaseUnit = table.Column<string>(type: "text", nullable: false),
                    Factor = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Conversions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Conversions_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Customers",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Address = table.Column<string>(type: "text", nullable: false),
                    TallyId = table.Column<string>(type: "text", nullable: true),
                    GstIn = table.Column<string>(type: "text", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Customers", x => x.Id);
                    table.UniqueConstraint("AK_Customers_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.ForeignKey(
                        name: "FK_Customers_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Labels",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    CartonSnapshots = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    OperatorId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Labels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Labels_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Mappings",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ExpectedCompany = table.Column<string>(type: "text", nullable: false),
                    TallyVersion = table.Column<string>(type: "text", nullable: false),
                    SalesLedger = table.Column<string>(type: "text", nullable: false),
                    VoucherType = table.Column<string>(type: "text", nullable: false),
                    Pattern = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: false),
                    ContractValidated = table.Column<bool>(type: "boolean", nullable: false),
                    StatutoryRequired = table.Column<bool>(type: "boolean", nullable: false),
                    SyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Mappings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Mappings_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Outbox",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    AuditId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Outbox", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Outbox_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Products",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Sku = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Unit = table.Column<string>(type: "text", nullable: false),
                    TallyId = table.Column<string>(type: "text", nullable: true),
                    TallyName = table.Column<string>(type: "text", nullable: true),
                    BookBalance = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: true),
                    SyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Products", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Products_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Requests",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ActorId = table.Column<string>(type: "text", nullable: false),
                    Fingerprint = table.Column<string>(type: "text", nullable: false),
                    Response = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Requests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Requests_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Trips",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Vehicle = table.Column<string>(type: "text", nullable: false),
                    Driver = table.Column<string>(type: "text", nullable: false),
                    Transporter = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DepartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Trips", x => x.Id);
                    table.UniqueConstraint("AK_Trips_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.ForeignKey(
                        name: "FK_Trips_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Email = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false),
                    Roles = table.Column<string[]>(type: "text[]", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                    table.UniqueConstraint("AK_Users_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.ForeignKey(
                        name: "FK_Users_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Warehouses",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    TallyGodown = table.Column<string>(type: "text", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Warehouses", x => x.Id);
                    table.UniqueConstraint("AK_Warehouses_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.ForeignKey(
                        name: "FK_Warehouses_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Sessions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    TokenHash = table.Column<string>(type: "text", nullable: false),
                    Csrf = table.Column<string>(type: "text", nullable: false),
                    Expires = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Sessions_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Sessions_Users_CompanyId_UserId",
                        columns: x => new { x.CompanyId, x.UserId },
                        principalTable: "Users",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Manifests",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    WarehouseId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    CustomerId = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: false),
                    Groups = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ApprovedBy = table.Column<string>(type: "text", nullable: true),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Manifests", x => x.Id);
                    table.UniqueConstraint("AK_Manifests_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.ForeignKey(
                        name: "FK_Manifests_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Manifests_Warehouses_CompanyId_WarehouseId",
                        columns: x => new { x.CompanyId, x.WarehouseId },
                        principalTable: "Warehouses",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Shipments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    TripId = table.Column<string>(type: "text", nullable: false),
                    CustomerId = table.Column<string>(type: "text", nullable: false),
                    WarehouseId = table.Column<string>(type: "text", nullable: false),
                    Destination = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    BillingVersion = table.Column<int>(type: "integer", nullable: false),
                    LoadApproved = table.Column<bool>(type: "boolean", nullable: false),
                    LoadApprovedBy = table.Column<string>(type: "text", nullable: true),
                    InvoiceJobId = table.Column<string>(type: "text", nullable: true),
                    Documents = table.Column<string>(type: "text", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Shipments", x => x.Id);
                    table.UniqueConstraint("AK_Shipments_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.ForeignKey(
                        name: "FK_Shipments_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_Customers_CompanyId_CustomerId",
                        columns: x => new { x.CompanyId, x.CustomerId },
                        principalTable: "Customers",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_Trips_CompanyId_TripId",
                        columns: x => new { x.CompanyId, x.TripId },
                        principalTable: "Trips",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shipments_Warehouses_CompanyId_WarehouseId",
                        columns: x => new { x.CompanyId, x.WarehouseId },
                        principalTable: "Warehouses",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Cartons",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    WarehouseId = table.Column<string>(type: "text", nullable: false),
                    ManifestId = table.Column<string>(type: "text", nullable: false),
                    Marking = table.Column<string>(type: "text", nullable: false),
                    Lines = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Attached = table.Column<bool>(type: "boolean", nullable: false),
                    Verified = table.Column<bool>(type: "boolean", nullable: false),
                    VerifiedBy = table.Column<string>(type: "text", nullable: true),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Held = table.Column<bool>(type: "boolean", nullable: false),
                    ParentCartonId = table.Column<string>(type: "text", nullable: true),
                    CustomerId = table.Column<string>(type: "text", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Cartons", x => x.Id);
                    table.UniqueConstraint("AK_Cartons_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.CheckConstraint("carton_revision", "\"Revision\" > 0");
                    table.ForeignKey(
                        name: "FK_Cartons_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Cartons_Manifests_CompanyId_ManifestId",
                        columns: x => new { x.CompanyId, x.ManifestId },
                        principalTable: "Manifests",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Cartons_Warehouses_CompanyId_WarehouseId",
                        columns: x => new { x.CompanyId, x.WarehouseId },
                        principalTable: "Warehouses",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Billings",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ShipmentId = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Snapshot = table.Column<string>(type: "text", nullable: false),
                    Total = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: false),
                    Approved = table.Column<bool>(type: "boolean", nullable: false),
                    ApprovedBy = table.Column<string>(type: "text", nullable: true),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Billings", x => x.Id);
                    table.UniqueConstraint("AK_Billings_CompanyId_Id", x => new { x.CompanyId, x.Id });
                    table.ForeignKey(
                        name: "FK_Billings_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Billings_Shipments_CompanyId_ShipmentId",
                        columns: x => new { x.CompanyId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LoadingSessions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ShipmentId = table.Column<string>(type: "text", nullable: false),
                    TripId = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Station = table.Column<string>(type: "text", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoadingSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LoadingSessions_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LoadingSessions_Shipments_CompanyId_ShipmentId",
                        columns: x => new { x.CompanyId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LoadingSessions_Trips_CompanyId_TripId",
                        columns: x => new { x.CompanyId, x.TripId },
                        principalTable: "Trips",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Allocations",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ShipmentId = table.Column<string>(type: "text", nullable: false),
                    CartonId = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Allocations", x => x.Id);
                    table.CheckConstraint("allocation_state", "\"State\" IN ('Reserved','Loaded','Departed','Released')");
                    table.ForeignKey(
                        name: "FK_Allocations_Cartons_CompanyId_CartonId",
                        columns: x => new { x.CompanyId, x.CartonId },
                        principalTable: "Cartons",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Allocations_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Allocations_Shipments_CompanyId_ShipmentId",
                        columns: x => new { x.CompanyId, x.ShipmentId },
                        principalTable: "Shipments",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Returns",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ShipmentId = table.Column<string>(type: "text", nullable: false),
                    CartonId = table.Column<string>(type: "text", nullable: false),
                    Lines = table.Column<string>(type: "text", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    Condition = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    ReplacementId = table.Column<string>(type: "text", nullable: true),
                    AccountingStatus = table.Column<string>(type: "text", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Returns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Returns_Cartons_CompanyId_CartonId",
                        columns: x => new { x.CompanyId, x.CartonId },
                        principalTable: "Cartons",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Returns_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Jobs",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    ShipmentId = table.Column<string>(type: "text", nullable: false),
                    BillingId = table.Column<string>(type: "text", nullable: false),
                    PayloadHash = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<string>(type: "text", nullable: false),
                    Detail = table.Column<string>(type: "text", nullable: false),
                    ConnectorId = table.Column<string>(type: "text", nullable: true),
                    LeaseExpires = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    VoucherReference = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompanyId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Jobs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Jobs_Billings_CompanyId_BillingId",
                        columns: x => new { x.CompanyId, x.BillingId },
                        principalTable: "Billings",
                        principalColumns: new[] { "CompanyId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Jobs_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Allocations_CompanyId_CartonId",
                table: "Allocations",
                columns: new[] { "CompanyId", "CartonId" },
                unique: true,
                filter: "\"Active\" = TRUE");

            migrationBuilder.CreateIndex(
                name: "IX_Allocations_CompanyId_Id",
                table: "Allocations",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Allocations_CompanyId_ShipmentId",
                table: "Allocations",
                columns: new[] { "CompanyId", "ShipmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_Audit_CompanyId_At",
                table: "Audit",
                columns: new[] { "CompanyId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_Audit_CompanyId_Id",
                table: "Audit",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Billings_CompanyId_Id",
                table: "Billings",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Billings_CompanyId_ShipmentId_Revision",
                table: "Billings",
                columns: new[] { "CompanyId", "ShipmentId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Cartons_CompanyId_Id",
                table: "Cartons",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Cartons_CompanyId_ManifestId",
                table: "Cartons",
                columns: new[] { "CompanyId", "ManifestId" });

            migrationBuilder.CreateIndex(
                name: "IX_Cartons_CompanyId_WarehouseId_State",
                table: "Cartons",
                columns: new[] { "CompanyId", "WarehouseId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_Connectors_CompanyId_Id",
                table: "Connectors",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Conversions_CompanyId_Id",
                table: "Conversions",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Customers_CompanyId_Id",
                table: "Customers",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_BillingId",
                table: "Jobs",
                column: "BillingId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_CompanyId_BillingId",
                table: "Jobs",
                columns: new[] { "CompanyId", "BillingId" });

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_CompanyId_Id",
                table: "Jobs",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Jobs_CompanyId_State",
                table: "Jobs",
                columns: new[] { "CompanyId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_Labels_CompanyId_Id",
                table: "Labels",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LoadingSessions_CompanyId_Id",
                table: "LoadingSessions",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LoadingSessions_CompanyId_ShipmentId",
                table: "LoadingSessions",
                columns: new[] { "CompanyId", "ShipmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_LoadingSessions_CompanyId_Station",
                table: "LoadingSessions",
                columns: new[] { "CompanyId", "Station" },
                unique: true,
                filter: "\"Active\" = TRUE");

            migrationBuilder.CreateIndex(
                name: "IX_LoadingSessions_CompanyId_TripId",
                table: "LoadingSessions",
                columns: new[] { "CompanyId", "TripId" });

            migrationBuilder.CreateIndex(
                name: "IX_Manifests_CompanyId_Id",
                table: "Manifests",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Manifests_CompanyId_WarehouseId",
                table: "Manifests",
                columns: new[] { "CompanyId", "WarehouseId" });

            migrationBuilder.CreateIndex(
                name: "IX_Mappings_CompanyId_Id",
                table: "Mappings",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Outbox_CompanyId_Id",
                table: "Outbox",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Products_CompanyId_Id",
                table: "Products",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Products_CompanyId_Sku",
                table: "Products",
                columns: new[] { "CompanyId", "Sku" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Requests_CompanyId_Id",
                table: "Requests",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Returns_CompanyId_CartonId",
                table: "Returns",
                columns: new[] { "CompanyId", "CartonId" });

            migrationBuilder.CreateIndex(
                name: "IX_Returns_CompanyId_Id",
                table: "Returns",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_CompanyId_Id",
                table: "Sessions",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_CompanyId_UserId",
                table: "Sessions",
                columns: new[] { "CompanyId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_TokenHash",
                table: "Sessions",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CompanyId_CustomerId",
                table: "Shipments",
                columns: new[] { "CompanyId", "CustomerId" });

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CompanyId_Id",
                table: "Shipments",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CompanyId_TripId",
                table: "Shipments",
                columns: new[] { "CompanyId", "TripId" });

            migrationBuilder.CreateIndex(
                name: "IX_Shipments_CompanyId_WarehouseId",
                table: "Shipments",
                columns: new[] { "CompanyId", "WarehouseId" });

            migrationBuilder.CreateIndex(
                name: "IX_Trips_CompanyId_Id",
                table: "Trips",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_CompanyId_Id",
                table: "Users",
                columns: new[] { "CompanyId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Warehouses_CompanyId_Id",
                table: "Warehouses",
                columns: new[] { "CompanyId", "Id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Allocations");

            migrationBuilder.DropTable(
                name: "Audit");

            migrationBuilder.DropTable(
                name: "Connectors");

            migrationBuilder.DropTable(
                name: "Conversions");

            migrationBuilder.DropTable(
                name: "Jobs");

            migrationBuilder.DropTable(
                name: "Labels");

            migrationBuilder.DropTable(
                name: "LoadingSessions");

            migrationBuilder.DropTable(
                name: "Mappings");

            migrationBuilder.DropTable(
                name: "Outbox");

            migrationBuilder.DropTable(
                name: "Products");

            migrationBuilder.DropTable(
                name: "Requests");

            migrationBuilder.DropTable(
                name: "Returns");

            migrationBuilder.DropTable(
                name: "Sessions");

            migrationBuilder.DropTable(
                name: "Billings");

            migrationBuilder.DropTable(
                name: "Cartons");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Shipments");

            migrationBuilder.DropTable(
                name: "Manifests");

            migrationBuilder.DropTable(
                name: "Customers");

            migrationBuilder.DropTable(
                name: "Trips");

            migrationBuilder.DropTable(
                name: "Warehouses");

            migrationBuilder.DropTable(
                name: "Companies");
        }
    }
}
