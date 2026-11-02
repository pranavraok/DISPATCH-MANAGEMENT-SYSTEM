using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Dispatch;

public abstract class Scoped { public string Id { get; set; } = Guid.NewGuid().ToString("N"); public string CompanyId { get; set; } = "demo"; }
public class Company { public string Id { get; set; } = "demo"; public string Name { get; set; } = "Electro Group of Industries"; public string Environment { get; set; } = "Production"; }
public class Warehouse : Scoped { public string Name { get; set; } = "Main warehouse"; public string? TallyGodown { get; set; } }
public class User : Scoped { public string Email { get; set; } = ""; public string Name { get; set; } = ""; public string PasswordHash { get; set; } = ""; public string[] Roles { get; set; } = []; public bool Active { get; set; } = true; }
public class Session : Scoped { public string UserId { get; set; } = ""; public string TokenHash { get; set; } = ""; public string Csrf { get; set; } = ""; public DateTimeOffset Expires { get; set; } }
public class Product : Scoped { public string Sku { get; set; } = ""; public string Name { get; set; } = ""; public string Unit { get; set; } = "packets"; public string? TallyId { get; set; } public string? TallyName { get; set; } public string? TallyGroup { get; set; } public string? HsnCode { get; set; } public decimal? GstRate { get; set; } public decimal? TallySellingPrice { get; set; } public decimal? BookBalance { get; set; } public DateTimeOffset? SyncedAt { get; set; } public bool InTally { get; set; } = true; }
public class Customer : Scoped { public string Name { get; set; } = ""; public string Address { get; set; } = ""; public string? TallyAddress { get; set; } public string? TallyId { get; set; } public string? TallyGroup { get; set; } public string? GstIn { get; set; } public bool InTally { get; set; } = true; }
public class UnitConversion : Scoped { public string ProductId { get; set; } = ""; public string FromUnit { get; set; } = ""; public string BaseUnit { get; set; } = ""; public decimal Factor { get; set; } }
public record ContentLine(string Sku, decimal Quantity, string Unit, string? Batch = null, string? Godown = null, decimal? BaseQuantity = null, string? BaseUnit = null);
public record PackedGroup(string Marking, int Count, ContentLine[] Lines);
public record TallyStockItem(string NativeId, string Name, string Unit, decimal Balance, string? HsnCode, decimal? GstRate, string? Group, decimal? StandardSellingPrice = null, string? ClassificationName = null);
public record TallyLedger(string NativeId, string Name, string? Group, string? Address, string? GstIn, string? StateName = null);
public record TallyMasterSnapshot(string Company, string Environment, TallyStockItem[] Items, TallyLedger[] Ledgers, string? CompanyState = null);
public sealed record TallyTaxLedgers(string Cgst, string Sgst, string Igst, bool Demo);
public static class TallyTaxLedgerResolver
{
    public static TallyTaxLedgers? Resolve(TallyMasterSnapshot? snapshot, bool demo)
    {
        // Older or not-yet-synced connector records can contain an empty JSON
        // object. Treat an incomplete master snapshot as unavailable instead
        // of letting one connector take down the entire company workspace.
        if (snapshot?.Ledgers is not { } ledgers) return null;
        string? Find(string head)
        {
            var candidates = ledgers.Where(x => x is not null && string.Equals(x.Group, "Duties & Taxes", StringComparison.OrdinalIgnoreCase)
                && x.Name.Contains(head, StringComparison.OrdinalIgnoreCase)
                && (demo ? x.Name.Contains("DEMO", StringComparison.OrdinalIgnoreCase)
                         : !x.Name.Contains("DEMO", StringComparison.OrdinalIgnoreCase)
                           && !x.Name.Contains("TEST", StringComparison.OrdinalIgnoreCase)
                           && !x.Name.Contains("ARCHIVE", StringComparison.OrdinalIgnoreCase)
                           && !x.Name.Contains("LEGACY", StringComparison.OrdinalIgnoreCase)
                           && !x.Name.Contains("INPUT", StringComparison.OrdinalIgnoreCase)
                           && !x.Name.Contains("PURCHASE", StringComparison.OrdinalIgnoreCase)
                           && !x.Name.Contains("ITC", StringComparison.OrdinalIgnoreCase)))
                .Select(x => x.Name).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            // When Tally has both an explicitly named output ledger (for example,
            // "Output CGST") and a generic ledger ("CGST"), use the explicit
            // output ledger for customer invoices. Keep refusing the mapping if
            // more than one explicit output ledger exists for the same tax head.
            var outputLedgers = candidates.Where(x => x.StartsWith("Output ", StringComparison.OrdinalIgnoreCase)).ToArray();
            if (outputLedgers.Length > 0) return outputLedgers.Length == 1 ? outputLedgers[0] : null;
            return candidates.Length == 1 ? candidates[0] : null;
        }
        var cgst = Find("CGST"); var sgst = Find("SGST"); var igst = Find("IGST");
        return cgst == null || sgst == null || igst == null ? null : new TallyTaxLedgers(cgst, sgst, igst, demo);
    }
}
public record TallyInvoiceLine(string Sku, string NativeId, string StockItemName, string Unit, decimal Quantity, decimal Rate, decimal DiscountPercent,
    decimal Amount, decimal GstRate, string HsnCode, decimal? BookBalance = null);
public record TallyInvoicePayload(string JobId, string Company, string Environment, string VoucherType, string Date,
    string PartyLedgerName, string PartyState, string CompanyState, string SalesLedger, string CgstLedger, string SgstLedger,
    string IgstLedger, string ChargeLedger, string GodownName, string Reference, string Narration, string Terms, decimal Freight, decimal OtherCharges, TallyInvoiceLine[] Lines,
    decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total);
public record TallyInvoiceReadback(string Company, string VoucherType, string VoucherNumber, string Date, string Reference,
    string PartyLedgerName, TallyInvoiceLine[] Lines, decimal Taxable, decimal Cgst, decimal Sgst, decimal Igst, decimal Total);
public record TallyInvoiceJobDetail(string Message, TallyInvoicePayload? Payload = null, TallyInvoiceReadback? Result = null, bool RetryAuthorized = false);
public record ConnectorDiagnostics(bool TallyReachable, string? Version = null, string? Detail = null);
public class DispatchOrder : Scoped
{
    public string Workflow { get; set; } = Workflows.StockFirst;
    public string Reference { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public string WarehouseId { get; set; } = "main";
    public string Destination { get; set; } = "";
    public int ExpectedCartons { get; set; }
    public string Lines { get; set; } = "[]";
    public string Notes { get; set; } = "";
    public string State { get; set; } = "Open";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public class Manifest : Scoped { public string Workflow { get; set; } = Workflows.StockFirst; public string? OrderId { get; set; } public string WarehouseId { get; set; } = "main"; public string Name { get; set; } = ""; public string? CustomerId { get; set; } public string Notes { get; set; } = ""; public string Groups { get; set; } = "[]"; public string State { get; set; } = "Draft"; public int Version { get; set; } = 1; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; public string? ApprovedBy { get; set; } public DateTimeOffset? ApprovedAt { get; set; } }
public class Carton : Scoped { public string WarehouseId { get; set; } = "main"; public string ManifestId { get; set; } = ""; public string Marking { get; set; } = ""; public string Lines { get; set; } = "[]"; public string State { get; set; } = "Available"; public int Revision { get; set; } = 1; public bool Attached { get; set; } public bool Verified { get; set; } public string? VerifiedBy { get; set; } public DateTimeOffset? VerifiedAt { get; set; } public bool Held { get; set; } public string? ParentCartonId { get; set; } public string? CustomerId { get; set; } }
public class Trip : Scoped { public string Workflow { get; set; } = Workflows.StockFirst; public string Vehicle { get; set; } = ""; public string Driver { get; set; } = ""; public string Transporter { get; set; } = ""; public string State { get; set; } = "Open"; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; public DateTimeOffset? DepartedAt { get; set; } }
public class Shipment : Scoped { public string Workflow { get; set; } = Workflows.StockFirst; public string? OrderId { get; set; } public string TripId { get; set; } = ""; public string CustomerId { get; set; } = ""; public string WarehouseId { get; set; } = "main"; public string Destination { get; set; } = ""; public string State { get; set; } = "Allocated"; public int BillingVersion { get; set; } public bool LoadApproved { get; set; } public string? LoadApprovedBy { get; set; } public string? InvoiceJobId { get; set; } public string Documents { get; set; } = "{}"; }
public class Allocation : Scoped { public string ShipmentId { get; set; } = ""; public string CartonId { get; set; } = ""; public string State { get; set; } = "Reserved"; public bool Active { get; set; } = true; }
public class LoadingSession : Scoped { public string ShipmentId { get; set; } = ""; public string TripId { get; set; } = ""; public string UserId { get; set; } = ""; public string Station { get; set; } = ""; public bool Active { get; set; } = true; public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow; public DateTimeOffset ExpiresAt { get; set; } = DateTimeOffset.UtcNow.AddHours(8); }
public class Billing : Scoped { public string ShipmentId { get; set; } = ""; public int Revision { get; set; } public string Snapshot { get; set; } = "{}"; public decimal Total { get; set; } public bool Approved { get; set; } public string? ApprovedBy { get; set; } public DateTimeOffset? ApprovedAt { get; set; } }
public class PostingJob : Scoped { public string ShipmentId { get; set; } = ""; public string BillingId { get; set; } = ""; public string PayloadHash { get; set; } = ""; public string State { get; set; } = "Blocked"; public string Detail { get; set; } = "The accountant must check the Tally setup and invoice results before sending."; public string? ConnectorId { get; set; } public DateTimeOffset? LeaseExpires { get; set; } public string? VoucherReference { get; set; } public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; }
public class Connector : Scoped { public string Name { get; set; } = ""; public string SecretHash { get; set; } = ""; public bool Revoked { get; set; } public string ExpectedCompany { get; set; } = ""; public string Environment { get; set; } = "Production"; public DateTimeOffset? LastSeen { get; set; } public string Diagnostics { get; set; } = "{}"; public string MastersSnapshot { get; set; } = "{}"; public DateTimeOffset? MastersSyncedAt { get; set; } }
public class Mapping : Scoped { public string ExpectedCompany { get; set; } = ""; public string TallyVersion { get; set; } = "Unknown"; public string SalesLedger { get; set; } = ""; public string VoucherType { get; set; } = "Sales"; public string Pattern { get; set; } = "Unvalidated"; public string Notes { get; set; } = ""; public bool ContractValidated { get; set; } = false; public bool StatutoryRequired { get; set; } = true; public DateTimeOffset? SyncedAt { get; set; } }
public class LabelJob : Scoped { public string Workflow { get; set; } = Workflows.StockFirst; public string CartonSnapshots { get; set; } = "[]"; public string State { get; set; } = "Prepared"; public string Reason { get; set; } = "Initial labels"; public string OperatorId { get; set; } = ""; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; }
public class ReturnRecord : Scoped { public string ShipmentId { get; set; } = ""; public string CartonId { get; set; } = ""; public string Lines { get; set; } = "[]"; public string Reason { get; set; } = ""; public string Condition { get; set; } = "Uninspected"; public string State { get; set; } = "Quarantine"; public string? ReplacementId { get; set; } public string AccountingStatus { get; set; } = "Credit/stock movement pending accountant review"; }
public class RequestRecord : Scoped { public string ActorId { get; set; } = ""; public string Fingerprint { get; set; } = ""; public string Response { get; set; } = "{}"; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; }
public class AuditEvent : Scoped { public string? Workflow { get; set; } public string ActorId { get; set; } = ""; public string Action { get; set; } = ""; public string EntityId { get; set; } = ""; public string Data { get; set; } = "{}"; public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow; }
public class OutboxEvent : Scoped { public string AuditId { get; set; } = ""; public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow; public DateTimeOffset? DeliveredAt { get; set; } }

public class DispatchDb(DbContextOptions<DispatchDb> options) : DbContext(options)
{
    public DbSet<Company> Companies => Set<Company>(); public DbSet<Warehouse> Warehouses => Set<Warehouse>(); public DbSet<User> Users => Set<User>(); public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Product> Products => Set<Product>(); public DbSet<Customer> Customers => Set<Customer>(); public DbSet<UnitConversion> Conversions => Set<UnitConversion>(); public DbSet<Manifest> Manifests => Set<Manifest>(); public DbSet<Carton> Cartons => Set<Carton>();
    public DbSet<Trip> Trips => Set<Trip>(); public DbSet<Shipment> Shipments => Set<Shipment>(); public DbSet<Allocation> Allocations => Set<Allocation>(); public DbSet<LoadingSession> LoadingSessions => Set<LoadingSession>(); public DbSet<Billing> Billings => Set<Billing>();
    public DbSet<PostingJob> Jobs => Set<PostingJob>(); public DbSet<Connector> Connectors => Set<Connector>(); public DbSet<Mapping> Mappings => Set<Mapping>(); public DbSet<LabelJob> Labels => Set<LabelJob>(); public DbSet<ReturnRecord> Returns => Set<ReturnRecord>();
    public DbSet<RequestRecord> Requests => Set<RequestRecord>(); public DbSet<AuditEvent> Audit => Set<AuditEvent>(); public DbSet<OutboxEvent> Outbox => Set<OutboxEvent>();
    public DbSet<DispatchOrder> Orders => Set<DispatchOrder>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        foreach (var type in typeof(Scoped).Assembly.GetTypes().Where(t => t.BaseType == typeof(Scoped)))
        {
            var e = b.Entity(type); e.HasBaseType((Type?)null); e.HasKey("Id"); e.HasIndex("CompanyId", "Id").IsUnique(); e.HasOne(typeof(Company)).WithMany().HasForeignKey("CompanyId").OnDelete(DeleteBehavior.Restrict);
            foreach (var p in type.GetProperties().Where(p => p.PropertyType == typeof(decimal) || p.PropertyType == typeof(decimal?))) e.Property(p.Name).HasPrecision(20, 6);
        }
        b.Entity<User>().HasIndex(x => x.Email).IsUnique(); b.Entity<Session>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<DispatchOrder>().ToTable("Orders");
        b.Entity<DispatchOrder>().Property(x => x.Workflow).HasDefaultValue(Workflows.StockFirst);
        b.Entity<Manifest>().Property(x => x.Workflow).HasDefaultValue(Workflows.StockFirst);
        b.Entity<Trip>().Property(x => x.Workflow).HasDefaultValue(Workflows.StockFirst);
        b.Entity<Shipment>().Property(x => x.Workflow).HasDefaultValue(Workflows.StockFirst);
        b.Entity<LabelJob>().Property(x => x.Workflow).HasDefaultValue(Workflows.StockFirst);
        b.Entity<DispatchOrder>().HasIndex(x => new { x.CompanyId, x.Workflow, x.Reference }).IsUnique();
        b.Entity<Manifest>().HasIndex(x => new { x.CompanyId, x.Workflow, x.CreatedAt });
        b.Entity<Trip>().HasIndex(x => new { x.CompanyId, x.Workflow, x.CreatedAt });
        b.Entity<Shipment>().HasIndex(x => new { x.CompanyId, x.Workflow });
        b.Entity<DispatchOrder>().ToTable(t => t.HasCheckConstraint("order_cartons", "\"ExpectedCartons\" BETWEEN 1 AND 10000"));
        b.Entity<DispatchOrder>().ToTable(t => t.HasCheckConstraint("order_workflow", Workflows.SqlCheck));
        b.Entity<Manifest>().ToTable(t => t.HasCheckConstraint("manifest_workflow", Workflows.SqlCheck));
        b.Entity<Trip>().ToTable(t => t.HasCheckConstraint("trip_workflow", Workflows.SqlCheck));
        b.Entity<Shipment>().ToTable(t => t.HasCheckConstraint("shipment_workflow", Workflows.SqlCheck));
        b.Entity<Manifest>().ToTable(t => t.HasCheckConstraint("manifest_order_required", "\"Workflow\" = 'StockFirst' OR \"OrderId\" IS NOT NULL"));
        b.Entity<Shipment>().ToTable(t => t.HasCheckConstraint("shipment_order_required", "\"Workflow\" = 'StockFirst' OR \"OrderId\" IS NOT NULL"));
        ScopedFk<DispatchOrder, Customer>(b, "CustomerId"); ScopedFk<DispatchOrder, Warehouse>(b, "WarehouseId");
        ScopedFk<Manifest, DispatchOrder>(b, "OrderId"); ScopedFk<Shipment, DispatchOrder>(b, "OrderId");
        b.Entity<Product>().HasIndex(x => new { x.CompanyId, x.Sku }).IsUnique(); b.Entity<Manifest>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<Allocation>().HasIndex(x => new { x.CompanyId, x.CartonId }).IsUnique().HasFilter("\"Active\" = TRUE");
        b.Entity<Billing>().HasIndex(x => new { x.CompanyId, x.ShipmentId, x.Revision }).IsUnique();
        b.Entity<PostingJob>().HasIndex(x => x.BillingId).IsUnique(); b.Entity<LoadingSession>().HasIndex(x => new { x.CompanyId, x.Station }).IsUnique().HasFilter("\"Active\" = TRUE");
        b.Entity<Carton>().HasIndex(x => new { x.CompanyId, x.WarehouseId, x.State }); b.Entity<AuditEvent>().HasIndex(x => new { x.CompanyId, x.At }); b.Entity<PostingJob>().HasIndex(x => new { x.CompanyId, x.State });
        ScopedFk<Session, User>(b, "UserId"); ScopedFk<Carton, Manifest>(b, "ManifestId"); ScopedFk<Carton, Warehouse>(b, "WarehouseId"); ScopedFk<Manifest, Warehouse>(b, "WarehouseId");
        ScopedFk<Shipment, Trip>(b, "TripId"); ScopedFk<Shipment, Customer>(b, "CustomerId"); ScopedFk<Shipment, Warehouse>(b, "WarehouseId"); ScopedFk<Allocation, Carton>(b, "CartonId"); ScopedFk<Allocation, Shipment>(b, "ShipmentId");
        ScopedFk<LoadingSession, Shipment>(b, "ShipmentId"); ScopedFk<LoadingSession, Trip>(b, "TripId"); ScopedFk<Billing, Shipment>(b, "ShipmentId"); ScopedFk<PostingJob, Billing>(b, "BillingId"); ScopedFk<ReturnRecord, Carton>(b, "CartonId");
        b.Entity<Allocation>().ToTable(t => t.HasCheckConstraint("allocation_state", "\"State\" IN ('Reserved','Loaded','Departed','Released')"));
        b.Entity<Carton>().ToTable(t => t.HasCheckConstraint("carton_revision", "\"Revision\" > 0"));
    }
    static void ScopedFk<T, D>(ModelBuilder b, string field) where T : Scoped where D : Scoped => b.Entity<T>().HasOne<D>().WithMany().HasForeignKey("CompanyId", field).HasPrincipalKey("CompanyId", "Id").OnDelete(DeleteBehavior.Restrict);
}
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString };
    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Options)!;
    public static T Read<T>(JsonElement value) => value.Deserialize<T>(Options)!;
}
public class RuleException(string message, int status = 400) : Exception(message) { public int Status { get; } = status; }
