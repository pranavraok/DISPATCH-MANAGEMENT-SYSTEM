# Architecture and operating boundaries

React 19 / TypeScript 7 renders the browser workspace. ASP.NET Core 10 LTS serves the API and the production SPA. EF Core / Npgsql 10 migrations create PostgreSQL tables from day one. The same image can run on a container host or a Vercel container function. Vercel availability is verified during deployment, not assumed from older runtime lists.

Scanner PC: desktop browser, D-5015 receiver, speaker and A4 printer. Cloud: authenticated API, PostgreSQL, audit feed and durable operations. Separate Tally Windows PC: paired diagnostics connector making outbound HTTPS and loopback XML calls. Browser printing runs in the interactive scanner user's session.

## Data and concurrency

Companies and warehouses scope records. Composite foreign keys prevent cross-company relationships between cartons, manifests, shipments, trips and allocations. Active allocations have a unique database index per company/carton. Requests carry stable UUIDs and payload hashes. A PostgreSQL advisory transaction lock per company serializes mutations in the first stage. This is conservative and measurable; it is not a claim of unlimited throughput. API instances may scale horizontally, but the company lock remains a throughput boundary.

An accepted scan, allocation state, carton state, saved response, audit event and outbox event commit together. The API returns acceptance only after commit. A new request for an already-loaded carton returns Duplicate. Reusing a request ID with different data returns Conflict. The original response can be queried by request ID. A missing lookup does not prove that an earlier request cannot still commit.

The browser stores only a versioned uncertain scan envelope, scoped to its original session/shipment/station. It is not inventory storage. The loading station intentionally allows one outstanding scan and pauses until it is resolved. Fast buffered input is not treated as accepted. This conservative input rate must be measured against the physical trial.

Operational tables: companies, warehouses, users/sessions, products/customers/conversions, manifests, cartons with immutable content snapshots, trips, shipments, allocations, loading sessions, billing revisions, posting jobs, labels, returns, connector pairings, requests, audit and outbox. Quantities and money use decimal in .NET and numeric(20,6) in PostgreSQL. Browser totals use decimal.js. Original and validated base unit quantities remain in carton snapshots.

The outbox stores committed audit-feed events. Optional container worker drains bounded batches with SKIP LOCKED; serverless deployments can call the authenticated maintenance endpoint. This is a polling feed implementation, not an email, SignalR or Tally delivery claim. Authoritative refresh always queries the database.

## Legal state transitions

| Aggregate | Transitions implemented | Actor |
|---|---|---|
| Manifest | Draft → Approved; approved content frozen | Packing clerk drafts; supervisor approves |
| Carton | Available → Reserved → Loaded → Departed | Dispatch supervisor reserves; loader scans; supervisor releases |
| Carton correction | Available → new revision, unverified/unattached | Packing supervisor |
| Physical repack | Available → Retired; linked new identities created | Packing supervisor |
| Allocation | Reserved → Loaded → Reserved on authorised unload; Reserved → Released | Loader / dispatch supervisor |
| Shipment | Allocated → Loading → LoadApproved → BillingDraft → BillingApproved → InvoiceBlocked | Explicit role permissions |
| Billing | New immutable revision; separate approval of current revision | Billing |
| Posting | Blocked in this stage | No production Create adapter enabled |
| Trip | Open → Departed only after all remaining shipments pass invoice/document gates | Dispatch supervisor |
| Return | Quarantine → Disposal / AwaitingAccountingRestock | Supervisor after physical receipt |

Departure and post-departure returns are exercised with explicitly simulated confirmed-voucher database fixtures. That does not verify real Tally posting. Ordinary application users cannot forge a Confirmed job through the API.

## Accounting boundary

Registering packed stock and scanning do not create Tally receipts or deductions. Tally remains the source of booked stock, ledgers and vouchers. Physical packed availability is a different measure. Draft billing contains no assumed GST or freight tax. Posting is deliberately blocked in code, not unlocked by a checkbox pretending to validate an unknown accounting pattern.

The connector implements secure outbound pairing, diagnostics, XML escaping, DTD rejection, expected company checks, bounded reconnect and a crash-safe attempt journal helper. Actual invoice creation, duplicate-marker discovery, voucher readback comparison, external edit/backup reconciliation and return-credit posting remain future integration stages requiring real exported vouchers. The journal tests verify the guard helper; they do not claim a completed posting pipeline.

## Current limits

Draft approval: at most 10,000 cartons and 1,000 groups. Import: 2 MB and 10,000 rows. Contents: at most 100 lines/carton. Label jobs: at most 1,000 selected IDs. Standard A4 labels reject contents that will not fit. No silent truncation is permitted. Batch/godown content entry is blocked until its Tally mapping is implemented. Product/customer browsing currently returns the first 500 records; carton state has a paginated API capped at 500/page. The first UI iteration shows 200 cartons; full large-catalogue navigation and virtualisation remain pending.

The 30–60 minute workload at 100,000 cartons / 500,000 events and 5/10/20 operators has not been run unless separately recorded in VALIDATION.md. Do not infer whole-system capacity from the small race test.
