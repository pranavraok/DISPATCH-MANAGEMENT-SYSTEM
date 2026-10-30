# Validation record

Build date: 30 October 2026. This record distinguishes executed software checks from simulated fixtures and real external verification.

| Check | Result | Evidence / boundary |
|---|---|---|
| ASP.NET Core API build | PASS, 0 warnings / 0 errors | .NET SDK 10.0.403, runtime 10.0.14, EF/Npgsql 10 |
| Windows connector build | PASS, 0 warnings / 0 errors | Source compiles; not installed on actual Tally PC |
| React/TypeScript production build | PASS | TypeScript 7.0.2, React 19.3.1, Vite 8.3.5; heavy PDF/Excel libraries load on demand |
| Frontend domain tests | 15 PASS | CSV/decimal/QR validation, mixed totals, leading zeros, export formula injection |
| Connector fixture tests | 7 PASS | Company XML escaping, DTD/XXE rejection, journal reopening, send uncertainty, hash immutability and blind retry guards |
| Real PostgreSQL/API integration suite | 35 PASS | Isolated PostgreSQL 18.4, actual .NET HTTP API, not an in-memory database |
| Additional workflow suite | 11 PASS | Unit conversions, mapping, revisions/repack, multi-customer jobs, simulated departure/print gates, partial returns/quarantine |
| Browser checks | PASS | Deployed login/sample dashboard, 390 px phone layout and disabled sample loading controls inspected. Local MD sign-in reached actual saved PostgreSQL state; write controls remained disabled |
| PostgreSQL backup/restore | PASS | Official pg_dump/pg_restore 18.4; all 23 table counts and posting job hashes matched a new disposable UTF-8 restore target. Live source was not overwritten |
| Windows self-contained packaging | PASS | win-x64 Release publication succeeded. Actual separate-PC installation remains pending |
| Actual application A4 PDF function | PASS generation, render and decode | A4 dimensions, no-clipping visual inspection, mixed text and independent QR round trip all passed; actual paper/scanner still pending |
| Vercel app + .NET API | ACTIVE | Root and /api/health return 200; hosted PostgreSQL reports Connected. Administrator/MD logins and cloud draft persistence passed |
| GitHub source push | PASS | Native connected GitHub write was denied; local Git credentials successfully pushed main to the exact user-provided repository |
| Cloud DB provisioning | Connected, temporary trial | Free temporary database expires 2 November 2026 at 13:10 UTC unless claimed. No claim of permanent production storage |
| Vercel runtime environment setup | PASS | User specifically approved on 30 October 2026. Credentials are sensitive production environment values, not frontend variables or source files |
| Tally invoice creation/readback | NOT IMPLEMENTED / NOT VERIFIED | No Create adapter is enabled; jobs remain Blocked |
| Scanner, A4 physical print and actual stock effect | PENDING ACTUAL SETUP | No D-5015, Tally machine or physical printer was available |

The 35-test suite covers strict server imports; idempotent draft/approval; 10 unique cartons and exact 680 Sandal / 220 Rose fixture totals; labels retaining identity; separate attachment/verification; held/obsolete/wrong-company/wrong-shipment codes; competing reservations; live station scope; 20 concurrent scan requests producing 1 acceptance and 19 duplicates; stable response recovery; new-session refresh; unload/reload; pricing/load permissions; exact-subset approval; billing revision invalidation; posting/departure blocks; connector scope/revocation; database unique allocation constraint; append-only audit trigger; session expiry; cross-company denial; persisted audit.

The 20-request mixed-carton race completed in 413 ms total on the local trial machine. This is a small race/correctness result, **not** a p95 scan SLA, sustained throughput benchmark or Tally throughput result.

The actual application PDF function generated a one-page 210 × 297 mm test PDF. A rendered inspection confirmed no clipping and both mixed-content lines. An independent jsQR decoder read the QR back from the rendered PDF as `K1|demo|CT-TEST0000000000000001|1`. This verifies genuine PDF QR output in software; the D-5015 and physical A4 printer are still unverified. Preview images are retained as dispatch-preview.jpg, dispatch-mobile.jpg and label-test.png in this directory.

The self-contained win-x64 connector was published under artifacts/connector. Its executable can run `--self-test` without a .NET SDK on the target machine. The source and packaged fixture tests are distinct from an actual Tally connection.

Deployment: https://electro-group-dispatch.vercel.app/ (production hosting target, trial application). Source: https://github.com/pranavraok/DISPATCH-MANAGEMENT-SYSTEM . Cloud database credentials are configured privately in Vercel. Authenticated sessions persist operational records online. The optional visible sample remains read-only and fictional. No Tally invoice posting is enabled.

Additional departure/return tests deliberately set isolated SQL job fixtures to Confirmed with references beginning SIMULATED-NO-INVOICE. They verify application gates without generating a real invoice or statutory reference. No accountant, legal document, Tally stock movement or actual printer success is implied.

## Pending implementation and integration work

- Validated Tally invoice template, marker discovery, preflight/stock policy, company GUID/version capabilities, posting attempt leases/stream, send/readback reconciliation and external edit/backup detection. The connector journal is only a tested guard helper, not that full pipeline.
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
