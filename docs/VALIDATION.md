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
| Desktop browser preview | PASS initial layout | Actual rendered login and read-only sample dashboard inspected; further browser checks recorded below when completed |
| Cloud DB provisioning | Created, unconnected | Free temporary database expires 2 November 2026 at 13:10 UTC unless claimed. No claim of permanent production storage |
| Vercel runtime environment setup | BLOCKED | Automatic approval review rejected transmitting the new DB URI and bootstrap passwords to Vercel without specific approval |
| Tally invoice creation/readback | NOT IMPLEMENTED / NOT VERIFIED | No Create adapter is enabled; jobs remain Blocked |
| Scanner, A4 physical print and actual stock effect | PENDING ACTUAL SETUP | No D-5015, Tally machine or physical printer was available |

The 35-test suite covers strict server imports; idempotent draft/approval; 10 unique cartons and exact 680 Sandal / 220 Rose fixture totals; labels retaining identity; separate attachment/verification; held/obsolete/wrong-company/wrong-shipment codes; competing reservations; live station scope; 20 concurrent scan requests producing 1 acceptance and 19 duplicates; stable response recovery; new-session refresh; unload/reload; pricing/load permissions; exact-subset approval; billing revision invalidation; posting/departure blocks; connector scope/revocation; database unique allocation constraint; append-only audit trigger; session expiry; cross-company denial; persisted audit.

The 20-request mixed-carton race completed in 413 ms total on the local trial machine. This is a small race/correctness result, **not** a p95 scan SLA, sustained throughput benchmark or Tally throughput result.

Additional departure/return tests deliberately set isolated SQL job fixtures to Confirmed with references beginning SIMULATED-NO-INVOICE. They verify application gates without generating a real invoice or statutory reference. No accountant, legal document, Tally stock movement or actual printer success is implied.

## Pending implementation and integration work

- Validated Tally invoice template, marker discovery, preflight/stock policy, company GUID/version capabilities, posting attempt leases/stream, send/readback reconciliation and external edit/backup detection. The connector journal is only a tested guard helper, not that full pipeline.
- Full ledger/item/unit/godown/batch import and mapping workflow; current master endpoint refreshes existing native-ID product links only. Rates from Tally remain unavailable. Batch/godown carton entry is blocked explicitly.
- Real confirmed invoice output, local unattended print agent if required, return-credit/restock accounting and replacement identities after authorised returned-stock verification.
- Autosave/resumable grid conflict UX beyond explicit versioned draft saves, whole-file duplicate import fingerprinting, large catalogue search/pagination/virtualisation, shipment reassignment editor, fully configured label sizes and selected failed-range reprint UI. No partial-row import is silently performed.
- Full production backup retention/PITR policy, operational monitoring/rate-limit distribution, account lockout/MFA policy, warehouse-specific user grants and a full security review. Current sessions and CSRF work and have tests; that does not establish production hardening.
- Suggested 100,000-carton / 500,000-event, 5,000-product, 5/10/20-operator, 30–60 minute runs and external accountant contention. No unlimited scaling promise is made.

## Physical acceptance checklist

1. Claim/configure permanent cloud PostgreSQL and approve private runtime credentials for the hosting project.
2. Run migrations, create named operator accounts and confirm MD phone access over HTTPS.
3. Print 10 unique trial labels at actual size, attach and physically verify contents; scan with the actual D-5015 in live HID + Enter mode.
4. Pair the connector on the separate Tally PC to an isolated company. Verify company identity/capabilities and mapping snapshots.
5. Accountant creates and exports correct representative vouchers. Implement the adapter against those exports and official XML examples.
6. Exercise saved-voucher/lost-response, connector crash, lease expiry, duplicate deliveries and restored-backup reconciliation before permitting real Create.
7. Verify one actual saved invoice and exactly one booked stock movement, genuine driver output, document gates, departure and return-credit treatment.
8. Execute agreed load and recovery workloads before declaring production readiness.
