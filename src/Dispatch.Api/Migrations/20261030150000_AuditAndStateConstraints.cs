using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
namespace Dispatch.Migrations;

[DbContext(typeof(DispatchDb))]
[Migration("20261030150000_AuditAndStateConstraints")]
public class AuditAndStateConstraints : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        CREATE FUNCTION reject_dispatch_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Operational audit is append-only'; END; $$;
        CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "Audit" FOR EACH ROW EXECUTE FUNCTION reject_dispatch_audit_mutation();
        ALTER TABLE "Cartons" ADD CONSTRAINT carton_state CHECK ("State" IN ('Available','Reserved','Loaded','Departed','Retired','Quarantine'));
        ALTER TABLE "Shipments" ADD CONSTRAINT shipment_state CHECK ("State" IN ('Allocated','Loading','LoadApproved','BillingDraft','BillingApproved','InvoiceBlocked','Departed','Cancelled'));
        ALTER TABLE "Trips" ADD CONSTRAINT trip_state CHECK ("State" IN ('Open','Departed'));
        ALTER TABLE "Jobs" ADD CONSTRAINT posting_state CHECK ("State" IN ('Blocked','Queued','Claimed','Sending','ConfirmationUnknown','Confirmed','Rejected','NeedsReview'));
        ALTER TABLE "Billings" ADD CONSTRAINT billing_total CHECK ("Total" >= 0 AND "Revision" > 0);
        ALTER TABLE "Conversions" ADD CONSTRAINT conversion_positive CHECK ("Factor" > 0);
        """);
    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DROP TRIGGER audit_append_only ON "Audit";
        DROP FUNCTION reject_dispatch_audit_mutation();
        ALTER TABLE "Cartons" DROP CONSTRAINT carton_state;
        ALTER TABLE "Shipments" DROP CONSTRAINT shipment_state;
        ALTER TABLE "Trips" DROP CONSTRAINT trip_state;
        ALTER TABLE "Jobs" DROP CONSTRAINT posting_state;
        ALTER TABLE "Billings" DROP CONSTRAINT billing_total;
        ALTER TABLE "Conversions" DROP CONSTRAINT conversion_positive;
        """);
}
