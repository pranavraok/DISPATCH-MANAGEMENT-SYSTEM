# Electro Group Dispatch

This production dispatch application is currently scoped to **Electro Group of Industries**. Aromazen is out of scope for this release. It records packed cartons, checks labels and loading, prepares billing, and sends approved sales invoices to the connected Tally company.

The application uses React/TypeScript, ASP.NET Core 10, and PostgreSQL. The complete implementation specification is retained in [docs/MASTER_SPECIFICATION.txt](docs/MASTER_SPECIFICATION.txt). Tally customer and stock masters sync from the connected company. A real sales voucher and stock readback, TallyPrime EDU licensing suitability, and permanent database retention remain outstanding before routine daily invoicing can be treated as fully accepted.

Production site: https://electro-group-dispatch.vercel.app/

The company correction and simple-English interface supersede the previous branding in the original master prompt. Sample item names and SKU quantities are fictional fixtures, not the company catalogue.

## Start

```powershell
Copy-Item .env.example .env
# Replace all three passwords with different strong values.
docker compose up --build
```

Open http://127.0.0.1:5080. Admin: admin@electrogroup.test; MD read-only: md@electrogroup.test. Use the respective private passwords you configured. No fixed production login is shipped.

For native Windows development, run the API on 5080 with a PostgreSQL connection and bootstrap environment variables, then `npm ci` / `npm run dev` inside web. Full commands: [Operator runbook](docs/OPERATOR_RUNBOOK.md).

## Implemented stages

- Independent company deployments from one source tree: **Order first** for Electro Group of Industries, **Pack before order** for AROMAZEN PVT LTD. Each uses a separate PostgreSQL project, credentials, users, masters and Tally pairing. Deployment-owned configuration locks the workflow on the server and client. See [Company sites](docs/WORKFLOWS.md).

- Shared work selection and grouped packing lists, vehicle trips and customer shipments across all operational sections. Same-customer shipments stay separate; the selection survives sidebar navigation and refresh. Settings remain company-wide.
- Work groups use readable cards, three across on desktop and one on phones. Compact display references retain the complete identity. New carton QRs use a shorter reversible code with the label revision; existing printed K1 labels remain accepted.

- PostgreSQL/EF migrations, HttpOnly sessions, CSRF, server-side permissions, company scope, append-only audit and durable request/outbox records.
- Packed drafts and strict all-or-nothing CSV/.xlsx preview, grouped/individual formats, physical approval and unique carton creation.
- Genuine QR A4 PDF jobs, revision-aware IDs, reasoned reprints, supervisor confirmation of labels and contents without scanning, holds and API content correction/repack. Cartons are scanned once during loading under Labels > Scan for dispatch.
- Partial reservations, multi-customer vehicle trips, station-bound loading, atomic mixed-carton acceptance, duplicate/race protection, uncertain-response recovery and audited unloading.
- Decimal billing revisions with authorised manual rates, discounts/charges and reasons. Unresolved tax/stock/voucher mapping blocks Tally posting.
- Separate Windows connector with CurrentUser DPAPI pairing, exact-company XML diagnostics, safe parsing, reconnect, durable invoice-attempt journal, production invoice import and exact-reference readback. A real Tally voucher create/readback remains unverified on the connected company.
- Electro-only automatic Tally master sync for every stock item, including items marked `DEMO -`, and all customer ledgers under Sundry Debtors. The connector refreshes Tally names, units, balances, HSN/GST details, and customer GST/address data every two minutes while it is running.
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

The Vercel production app and PostgreSQL connection are active. The database backing this deployment is temporary and must be claimed or migrated before its provider's expiry deadline. Administrator/MD logins and saved state were verified over HTTPS. Demo records remain fictional. The Tally connector is production-scoped; a real voucher create/readback is still pending.

Vercel Git integration needs the account's GitHub Login Connection; direct API deployment is supported independently. No automatic source-to-production pipeline is claimed until that connection is configured.

## Required next integration stage

Actual D-5015/manual and A4 printer checks; exact installed Tally/company identity; accountant-exported representative XML; master/stock/pricing mappings; validated invoice template, duplicate marker and complete voucher/stock readback; genuine invoice printing and applicable statutory gates. Until then no live invoice posting or stock movement is enabled. Keep Tally/database ports private.

[Architecture](docs/ARCHITECTURE.md) · [Operator runbook](docs/OPERATOR_RUNBOOK.md) · [Build checklist](docs/BUILD_CHECKLIST.md) · [API contract](docs/API.md)
