# Validation record

Build date: 30 October 2026. This record distinguishes executed software checks from simulated fixtures and real external verification.

## Electro production invoice work — 1 November 2026

The Electro site is being converted from the earlier Test-only connector scope to the company's production scope. The app validates the exact company and synced ledgers/items, queues a fixed invoice payload, uses a durable connector journal and unique dispatch reference, imports through Tally XML, reconciles by exact-reference readback, and exposes an invoice PDF only after confirmation. The printed output includes fields from the supplied Sales 501 example. The production source builds successfully. A real voucher create/readback has not yet been completed; validate the import against a voucher exported from this exact company before relying on it for accounting. Aromazen remains outside this change.

| Check | Result | Evidence / boundary |
|---|---|---|
| ASP.NET Core API build | PASS, 0 warnings / 0 errors | .NET SDK 10.0.403, runtime 10.0.14, EF/Npgsql 10 |
| Windows connector build | PASS, 0 warnings / 0 errors | Production-scoped build installed on the Electro Tally PC; current heartbeat and master sync visible |
| React/TypeScript production build | PASS | TypeScript 7.0.2, React 19.3.1, Vite 8.3.5; heavy PDF/Excel libraries load on demand |
| Frontend domain tests | 15 PASS | CSV/decimal/QR validation, mixed totals, leading zeros, export formula injection |
| Connector fixture tests | 7 PASS | Company XML escaping, DTD/XXE rejection, journal reopening, send uncertainty, hash immutability and blind retry guards |
| Real PostgreSQL/API integration suite | 35 PASS | Isolated PostgreSQL 18.4, actual .NET HTTP API, not an in-memory database |
| Additional workflow suite | 11 PASS | Unit conversions, mapping, revisions/repack, multi-customer jobs, simulated departure/print gates, partial returns/quarantine |
| Browser checks | PASS | Deployed login/sample dashboard, 390 px phone layout and disabled sample loading controls inspected. Local MD sign-in reached actual saved PostgreSQL state; write controls remained disabled |
| PostgreSQL backup/restore | PASS | Official pg_dump/pg_restore 18.4; all 23 table counts and posting job hashes matched a new disposable UTF-8 restore target. Live source was not overwritten |
| Windows self-contained packaging | PASS | win-x64 Release publication succeeded. Actual separate-PC installation remains pending |
| Actual application A4 PDF function | PASS generation, render and decode | A4 dimensions, no-clipping visual inspection, mixed text and independent QR round trip all passed; actual paper/scanner still pending |
| Vercel app + .NET API | ACTIVE | Production release Ready; /api/health returns 200, PostgreSQL Connected, production invoice mapping enabled |
| GitHub source push | PASS | Native connected GitHub write was denied; local Git credentials successfully pushed main to the exact user-provided repository |
| Cloud DB provisioning | Connected, temporary trial | Free temporary database expires 2 November 2026 at 13:10 UTC unless claimed. No claim of permanent production storage |
| Vercel runtime environment setup | PASS | User specifically approved on 30 October 2026. Credentials are sensitive production environment values, not frontend variables or source files |
| Tally invoice creation/readback | IMPLEMENTED IN SOURCE / NOT LIVE-VERIFIED | Production-scoped adapter and exact-reference readback are present; there are no approved bills or invoices yet |
| Scanner, A4 physical print and actual stock effect | PENDING ACTUAL SETUP | No D-5015, Tally machine or physical printer was available |

The 35-test suite covers strict server imports; idempotent draft/approval; 10 unique cartons and exact 680 Sandal / 220 Rose fixture totals; labels retaining identity; separate attachment/verification; held/obsolete/wrong-company/wrong-shipment codes; competing reservations; live station scope; 20 concurrent scan requests producing 1 acceptance and 19 duplicates; stable response recovery; new-session refresh; unload/reload; pricing/load permissions; exact-subset approval; billing revision invalidation; posting/departure blocks; connector scope/revocation; database unique allocation constraint; append-only audit trigger; session expiry; cross-company denial; persisted audit.

The 20-request mixed-carton race completed in 413 ms total on the local trial machine. This is a small race/correctness result, **not** a p95 scan SLA, sustained throughput benchmark or Tally throughput result.

The actual application PDF function generated a one-page 210 × 297 mm test PDF. A rendered inspection confirmed no clipping and both mixed-content lines. An independent jsQR decoder read the QR back from the rendered PDF as `K1|demo|CT-TEST0000000000000001|1`. This verifies genuine PDF QR output in software; the D-5015 and physical A4 printer are still unverified. Preview images are retained as dispatch-preview.jpg, dispatch-mobile.jpg and label-test.png in this directory.

The self-contained win-x64 connector was published under artifacts/connector. Its executable can run `--self-test` without a .NET SDK on the target machine. The source and packaged fixture tests are distinct from an actual Tally connection.

Deployment: https://electro-group-dispatch.vercel.app/ (production hosting target, trial application). Source: https://github.com/pranavraok/DISPATCH-MANAGEMENT-SYSTEM . Cloud database credentials are configured privately in Vercel. Authenticated sessions persist operational records online. The optional visible sample remains read-only and fictional. No Tally invoice posting is enabled.

Additional departure/return tests deliberately set isolated SQL job fixtures to Confirmed with references beginning SIMULATED-NO-INVOICE. They verify application gates without generating a real invoice or statutory reference. No accountant, legal document, Tally stock movement or actual printer success is implied.

## Pending implementation and integration work

- Validate the import XML against a Sales voucher exported from this exact Tally company, then complete an accountant-approved create/readback cycle. Confirm version/GUID handling and recovery after external edits or backups.
- Full ledger/item/unit/godown/batch import and mapping workflow; current master endpoint refreshes existing native-ID product links only. Rates from Tally remain unavailable. Batch/godown carton entry is blocked explicitly.
- Real confirmed invoice output, local unattended print agent if required, return-credit/restock accounting and replacement identities after authorised returned-stock verification.
- Autosave/resumable grid conflict UX beyond explicit versioned draft saves, whole-file duplicate import fingerprinting, large catalogue search/pagination/virtualisation, shipment reassignment editor, fully configured label sizes and selected failed-range reprint UI. No partial-row import is silently performed.
- Full production backup retention/PITR policy, operational monitoring/rate-limit distribution, account lockout/MFA policy, warehouse-specific user grants and a full security review. Current sessions and CSRF work and have tests; that does not establish production hardening.
- Suggested 100,000-carton / 500,000-event, 5,000-product, 5/10/20-operator, 30–60 minute runs and external accountant contention. No unlimited scaling promise is made.

## Physical acceptance checklist

1. Claim the connected trial PostgreSQL database before expiry, or move to a permanent database. Runtime credential activation is complete.
2. Run migrations, create named operator accounts and confirm MD phone access over HTTPS.
3. Print 10 unique trial labels at actual size, attach and physically verify contents; scan with the actual D-5015 in live HID + Enter mode.
4. Pair the connector on the separate Tally PC to an isolated company. Verify company identity/capabilities and mapping snapshots.
5. Accountant creates and exports correct representative vouchers. Implement the adapter against those exports and official XML examples.
6. Exercise saved-voucher/lost-response, connector crash, lease expiry, duplicate deliveries and restored-backup reconciliation before permitting real Create.
7. Verify one actual saved invoice and exactly one booked stock movement, genuine driver output, document gates, departure and return-credit treatment.
8. Execute agreed load and recovery workloads before declaring production readiness.

## Cloud activation check, 30 October 2026

Hosted health, administrator login, MD login, Secure/HttpOnly session cookies, fictional draft persistence across fresh sessions, same-request idempotency and MD write denial (403) passed against the actual HTTPS application. The check created one unapproved fictional draft and zero cartons. No Tally request, real invoice, physical approval or stock movement was performed. Startup migrations were disabled after successful initialization.

## Electro Group update, 30 October 2026

Branding now uses Electro Group of Industries / Electrotech Services in the application, PDF labels and packing lists, API health, connector service, account defaults, and hosting project. A one-time migration corrected the known trial company and generated trial email aliases without changing passwords, IDs, carton quantities, packing lists, or dispatch history. The hosted database migration and preservation checks passed.

The home page now has four plain-language steps; navigation, operator messages, roles, status labels, carton details and return handling use simpler English. Returns use item quantity fields instead of editable JSON. The new return form was used through the browser to save a fictional partial mixed-carton return in the isolated local database.

Regression: 35 PostgreSQL/API integration tests, 11 final-flow fixture tests, 15 frontend domain tests, and 7 connector guard tests passed (68 total). Departure/invoice successes are explicit local fixtures, not real Tally postings. TypeScript, Vite, API and connector builds passed. The rebranded A4 PDF was rendered and its QR independently decoded with the original carton identity unchanged. Real printer dimensions, D-5015 input/sound and the installed Tally/accounting checks remain pending.

Live release check: https://electro-group-dispatch.vercel.app returned HTTP 200, and the same-origin API reported Connected with postingEnabled=false. Administrator and management logins passed with Secure/HttpOnly cookies, all three prior packing drafts remained unchanged, and management writes returned 403. The deployed login and home screen were checked in the browser. Desktop and narrow layouts were visually inspected; physical phone and warehouse-device acceptance are still pending. Source release: 7245e37.

## Refresh and saved sign-in fix, 30 October 2026

The initial screen now waits for the server to check the saved session before showing the login form. Only a confirmed HTTP 401 opens sign-in. Network/database failures show a retry screen and retain the saved session cookie. The selected screen is kept in the URL hash and restored on refresh. Explicit logout waits for server confirmation and restored sessions receive their server CSRF token. Authentication expiry, server permissions and Tally/scanner rules are unchanged.

23 frontend tests passed, including 8 new mounted-React regression tests for delayed authentication without a login flash, true expiry, temporary database and network failures, page restoration, CSRF/logout persistence, failed logout and login followed by a data-load retry. TypeScript and Vite builds passed. A local browser refresh at #loading restored the authenticated loading screen.

Production check passed on deployment dpl_3mkuQ73FAEdYqYcgKL8oo6ceFvxM (source e1d225d). The existing browser session survived the deployment and reload. Selecting Load cartons changed the URL to #loading; refreshing showed the session-loading screen and restored the authenticated loading page without credential entry. API health remained HTTP 200 / Connected, with Tally posting disabled. No packing, carton, invoice or scan records were modified in this check. Screenshot: session-refresh.jpg.

## Grouped work and multiple shipments, 30 October 2026

A shared Show work selector follows the selected packing list, vehicle trip, or individual customer shipment across Home, Packing, Cartons & labels, Trips & customers, Load cartons, Billing & Tally, Returns and Reports. The selection is kept in the URL and survives refresh. Settings remain company-wide. Sidebar links are arranged under Prepare, Dispatch, History and Company.

Cartons use actual packing/active-allocation links; two shipments for the same customer are never merged. Unassigned cartons remain under their packing list. Split packing lists can span trips. Shared historical print jobs are labelled shared rather than falsely assigned to one shipment. Changing work clears label selection and is blocked while a scan result is uncertain. The existing physical verification and posting rules are unchanged.

The authenticated, company-scoped GET /api/work/{kind}/{id} endpoint retrieves related carton pages, packing lists, shipments, trips, allocations, bills, jobs, returns, recent print jobs and audit records. Pages contain up to 500 cartons; the UI currently loads up to 5,000 details per selected work and explicitly warns when incomplete. Recent selected-work print/audit windows are 100/80. These are bounded views, not unlimited scale acceptance.

Validation: 41 frontend tests passed (including 10 grouping-domain and 8 mounted-UI cases, plus the existing session/domain suites); 9 real PostgreSQL/API grouping tests passed. Fixtures covered repeat customers across vehicles, different customers on one vehicle, packing lists split across shipments with leftover stock, 501-carton paging, authentication, invalid scopes and cross-company denial. The API build/publish, TypeScript and Vite builds passed. All fixtures were isolated local test data; no real Tally, scanner or printer was used.

Browser check against the combined local production build passed: Home displayed two fictional vehicle trips and separate customer shipments; Labels showed only the selected shipment’s cartons; switching customer cleared earlier label selections; Billing retained the selected shipment; Loading preselected its customer/vehicle and preserved that work on refresh. No scan or accounting operation was performed during the browser check.

The carton reservation dialog also groups eligible cartons by packing list. Operators may choose a packing list to retrieve its carton pages independently of the initial dashboard window, select a whole eligible group, and see the target vehicle. Billing review and carton detail dialogs identify their shipment/packing context. Mounted tests cover grouped reservation and fetching a packing list whose cartons were absent from the initial list.

## Cleaner daily screens, 30 October 2026

The home screen uses a compact summary and short task links. Sidebar labels are shorter, the shared work selector is smaller, and multiple record groups or vehicle trips start collapsed. Opening a group shows its details; a single group opens automatically. Carton search expands matching groups. Home gives each shipment one Open shipment action, while Trips keeps loading actions visible and places labels, documents and carton adjustments under More actions. Printer dimensions and completed print history are expandable. Settings omit the work filter because they apply company-wide.

All 41 frontend tests, the TypeScript check and the Vite production build passed using an isolated copy of the current source and the pinned dependency cache. Browser checks with fictional fixtures covered shipment selection from Home, Labels and Trips, collapsed groups, and narrow-screen navigation. No operational records, scan results or accounting data were changed.

## One scan under Labels, 30 October 2026

The separate carton-verification scan and Loading navigation entry are removed. Labels contains Print & attach labels and Scan for dispatch. A supervisor confirms the selected cartons' matching labels and actual contents without scanning; the API records the operator and time against their displayed revisions. Older attachment-only payloads, stale revisions, held cartons and unauthorised roles are rejected. The existing transactional loading scan now lives under Labels and still protects customer/vehicle context, duplicates, mixed-carton quantities and uncertain response recovery. Older Loading bookmarks open this single scanner. Load approval remains a separate physical confirmation and requires every reserved carton to be loaded.

45 frontend tests cover the updated grouping/session suites plus confirmation without a verification QR, one dispatch submission, saved scan view on refresh, legacy bookmarks and pending scan recovery. TypeScript, Vite production and API builds passed. The updated PostgreSQL integration suites and dedicated single-scan scenario are included, but could not execute in this session: the sandbox denied the isolated local PostgreSQL connection with EACCES. The browser and Node runtime tools also became unavailable, so no new browser/device acceptance is claimed. No production operational records were changed by testing.

## Work cards and compact carton QR, 30 October 2026

Packing, carton, label, billing, return and report group summaries share the responsive work-card layout. Home and Trips use matching trip and shipment cards. Three cards fit a desktop row, two at the intermediate breakpoint and one on phones. Expanded details span the grid so operational tables remain readable. Primary text and controls are larger. Display references preserve all original identity bits; persisted IDs and selector values remain unchanged.

The compact QR carries the full 80-bit carton identity and revision. The browser and API share fixed vectors and canonical decoding rules. The existing authenticated company-scoped resolver and stale-revision guards remain in force, and old K1 labels still resolve. Frontend codec checks cover 256 full-identity round trips, revision boundaries, malformed payloads and legacy compatibility. A standalone C# codec check covers the same cross-language vector, 1,000 random round trips, revision bounds, malformed codes and legacy fallback; both container builds run it before publishing the API.

All 50 frontend checks, TypeScript and the Vite production build passed. Browser checks with fictional data verified three equal desktop columns, expanded tables, Trips customer cards and a 390px phone layout without page overflow. The actual application label PDF was generated for compact, maximum-revision and legacy identities, rendered and visually inspected. All three embedded PDF QR images were extracted and independently decoded to the exact payloads. Physical printer/scanner acceptance remains pending. No production operational records are mutated for these checks.

## Controlled deletion and fresh trial start

Deletion controls live within existing card details. The API enforces company scope, supervisor permissions, a reason, confirmation, packing-version checks and transactional dependency checks. Unused packing lists can be deleted, unloaded/unapproved/uninvoiced shipments release reservations when deleted, and only empty undeparted trips can be deleted. Audit snapshots remain. Selected work returns to All work after deletion. Three new frontend tests cover confirmation/reason, cancellation, stale conflicts, read-only roles and clearing the selected record; all 53 frontend tests and the production build pass.

`tests/deletion.mjs` exercises these behaviours against an isolated company, including idempotency, reserved-list blocking, loading-session cleanup, loaded/invoiced guards and a compact QR scan. The one-time fresh-start maintenance is separate from normal deletion: it clears trial transactions, sample masters and their old history, preserving login access and the company's base configuration. No general database-wipe control is exposed in the UI.
# Dual workflow verification - 31 October 2026

Two dashboards now share a company database, login, masters, Tally setup and scanner/printing components. The migration adds order records and persisted workflow links; a separate upgrade test applied the previous schema, inserted existing packing/trip records, then applied the new idempotent migration and confirmed both records and their identities remained intact under StockFirst.

Executed locally with fictional data: 59 frontend tests passed; TypeScript and Vite production builds passed; the API build passed with zero warnings/errors; the 36 existing PostgreSQL/API dispatch checks passed, including twenty competing scans accepting one carton once; the single-scan API suite passed; the 9 grouped-work API checks passed. The new dual-workflow API suite verifies both paths through approved loading and billing review, shared connector/mapping/master identities, cross-workflow and cross-order rejection, leftover stock, product/carton limits, order deletion guards and disabled real Tally posting.

The browser preview uses an isolated PostgreSQL database and a local-only QA session proxy. The proxy and its credentials are ignored temporary development files and are excluded from deployment. Physical Tally/scanner/printer operation is not represented as tested.

## Independent company activation - 31 October 2026

Aromazon was redeployed with its own sensitive production DATABASE_URL and bootstrap settings after explicit user approval. Both live sites returned health 200, administrator login 200 and saved-session read 200. The opposite workflow returned 409, and cross-company session cookies returned 401. An Aromazon mapping notes probe persisted and was restored; Electro’s mapping remained identical. The Aromazon management account signed in successfully and was denied a write with 403. Aromazon remained empty of products, cartons, orders and trips. Real Tally posting and physical devices were not tested.
