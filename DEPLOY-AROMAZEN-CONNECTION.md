# AROMAZEN production connection: handoff to deployment owner

Deploy this source only to the existing project serving:

https://aromazon-india-dispatch.vercel.app/

Do not deploy this release to Electro, change Electro's environment variables, or connect AROMAZEN to Electro's database.

## Before deployment

1. Confirm the Vercel account/team owns the existing AROMAZEN project and domain. Preserve its current deployment identifier for rollback.
2. Back up AROMAZEN's current PostgreSQL database privately. Preserve its existing database URL, bootstrap settings and other private environment values. No credentials are included in this source archive.
3. Verify these server-side settings on the AROMAZEN project:
   - `DispatchSite=aromazon`
   - `AromazenTallyCompany=AROMAZEN PRIVATE LIMITED`
   - The database connection points to AROMAZEN's own existing database.
4. Keep the existing .NET/container deployment approach. The provided `vercel.json` uses the `aromazen-dispatch` service and `Dockerfile.vercel`. Do not replace the application with a static-only frontend deployment.

## Deploy and verify

1. Deploy this source to the existing AROMAZEN project. Follow the existing migration process after reviewing pending migrations against the database backup. This package excludes the new first-receipt-scan migration.
2. Verify `/api/site` reports `slug=aromazon`, `companyId=aromazon-india` and `workflow=StockFirst`.
3. Verify `/api/health` reports the AROMAZEN API and connected database. `postingEnabled=false` is expected until the accountant validates mapping; do not force that flag on.
4. Confirm normal sign-in and existing AROMAZEN records still work. Note the deployed URL/version and give those details to the user. No production invoice or stock adjustment is needed for this deployment check.

## Completion on the user's Tally PC

After the hosted update is verified, Codex can run `scripts/upgrade-aromazen-production.ps1` on the already-paired Windows account. It checks the exact local company, authenticates using the existing Windows-protected AROMAZEN credential, requests the audited server-side Test-to-Production transition, and updates the local profile only after server acknowledgment. The protected Test profile is backed up. No secret needs to be sent to the deployment owner or pasted into chat.

Codex then starts the AROMAZEN connector in Production mode and checks heartbeat and master synchronization. Accountant validation of real sales/GST ledgers remains separate from establishing the Production connection. The observed ledger `Practice - Perfume Sales` has not been confirmed as the intended ledger for real invoices.

## Scope and checks

This release is the connection update requested first. It does not include the subsequent revised QR-generation/inventory workflow. That local implementation is to proceed after the Production connection succeeds.

API, connector and frontend builds passed. Ten isolated PostgreSQL/API production-transition checks passed, including exact-company checks, unchanged key, audit/idempotency, Production heartbeat, blocked old Test heartbeat, outstanding-job refusal, revoked credentials and Electro isolation. No real Tally voucher was created by these tests.
