# Kriyantha Dispatch Control

Case 2 packed-carton registration, unique QR labelling, verified dispatch and controlled billing for KR Vishwanath Agarbatti Works.

This is a runnable React/TypeScript + ASP.NET Core 10 + PostgreSQL application, not only a visual prototype. The complete implementation specification is retained in [docs/MASTER_SPECIFICATION.txt](docs/MASTER_SPECIFICATION.txt). Delivery is staged. Actual Tally invoice creation/readback and production readiness are **not** claimed.

## Start

```powershell
Copy-Item .env.example .env
# Replace all three passwords with different strong values.
docker compose up --build
```

Open http://127.0.0.1:5080. Admin: admin@kriyantha.test; MD read-only: md@kriyantha.test. Use the respective private passwords you configured. No fixed production login is shipped.

For native Windows development, run the API on 5080 with a PostgreSQL connection and bootstrap environment variables, then `npm ci` / `npm run dev` inside web. Full commands: [Operator runbook](docs/OPERATOR_RUNBOOK.md).

## Implemented stages

- PostgreSQL/EF migrations, HttpOnly sessions, CSRF, server-side permissions, company scope, append-only audit and durable request/outbox records.
- Packed drafts and strict all-or-nothing CSV/.xlsx preview, grouped/individual formats, physical approval and unique carton creation.
- Genuine QR A4 PDF jobs, revision-aware IDs, reasoned reprints, separate attachment and supervisor scan verification, holds and API content correction/repack.
- Partial reservations, multi-customer vehicle trips, station-bound loading, atomic mixed-carton acceptance, duplicate/race protection, uncertain-response recovery and audited unloading.
- Decimal billing revisions with authorised manual rates, discounts/charges and reasons. Unresolved tax/stock/voucher mapping blocks Tally posting.
- Separate Windows connector with CurrentUser DPAPI pairing, exact test-company XML diagnostics, safe parsing, reconnect and journal guard fixtures. Production posting adapter remains unimplemented.
- Packing-list PDFs, document/departure gates and quarantined full/partial return records. Real confirmed-invoice output, credit/restock posting and full return redispatch remain pending integration work.

## Verification

```powershell
dotnet build src/Dispatch.Api
dotnet build src/Dispatch.Connector
dotnet run --project src/Dispatch.Connector -- --self-test
cd web
npm ci
npm test
npm run build
cd ../tests
npm ci
# Set DISPATCH_TEST_PASSWORD and DISPATCH_TEST_DATABASE for an isolated test database.
npm test
node final-flows.mjs
```

Integration suites create clearly fictional test records and require a running seeded API. `final-flows.mjs` needs the blocked shipment created by `integration.mjs`; it uses explicit SQL fixtures to test departure/return gates, never real Tally success. See [Validation](docs/VALIDATION.md) for executed results and pending checks.

## Deployment

Dockerfile serves the SPA and .NET API from one origin on port 8080. Dockerfile.vercel uses the Vercel container runtime on port 80. Persist all data in a private TLS PostgreSQL database; the container holds no operational filesystem state. Keep bootstrap credentials and DATABASE_URL exclusively in private runtime environment variables. Never place them in VITE_* variables or tracked files.

The Vercel app and PostgreSQL connection are active for the trial. Administrator/MD logins and draft persistence across fresh sessions were verified over HTTPS. The optional sample remains read-only and fictional. Tally posting remains blocked, and the temporary database must be claimed before expiry; this is not production-readiness acceptance.

Vercel Git integration needs the account's GitHub Login Connection; direct API deployment is supported independently. No automatic source-to-production pipeline is claimed until that connection is configured.

## Required next integration stage

Actual D-5015/manual and A4 printer checks; exact installed Tally/company identity; accountant-exported representative XML; master/stock/pricing mappings; validated invoice template, duplicate marker and complete voucher/stock readback; genuine invoice printing and applicable statutory gates. Until then no live invoice posting or stock movement is enabled. Keep Tally/database ports private.

[Architecture](docs/ARCHITECTURE.md) · [Operator runbook](docs/OPERATOR_RUNBOOK.md) · [Build checklist](docs/BUILD_CHECKLIST.md) · [API contract](docs/API.md)
