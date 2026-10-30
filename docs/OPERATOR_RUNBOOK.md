# Operator runbook

All sample names, prices and documents are fictional. The first trial targets an isolated Tally TEST company only.

## 1. Online application and secure MD access

The repository contains a multi-stage Dockerfile, Docker Compose configuration and Dockerfile.vercel. PostgreSQL is required for authenticated operations. No public sample login password is compiled into the frontend. The read-only sample can be opened without an API; every screen labels it as fictional and disables writes.

Create environment variables on the hosting project: DATABASE_URL (private TLS PostgreSQL URI), BootstrapPassword (unique 12+ characters), BootstrapMdPassword (a different unique password), MigrateOnStart=true for the initial release. After successful bootstrap, disable automatic production seeding and run controlled migrations on later releases. Keep the app and API under one HTTPS origin so session cookies and CSRF checks remain correct. The container listens on 80 on Vercel, 8080 on other hosts.

Admin email defaults to admin@kriyantha.test. MD email defaults to md@kriyantha.test. Initial passwords are supplied through private environment configuration. Create named operator accounts in Settings. MD has server-enforced read-only access and a responsive dashboard. Do not share the administrator account with loaders.

## 2. Local startup on Windows

Install Node 22.22.2 or a supported newer LTS, the .NET 10.0.403 SDK and PostgreSQL 18 (or Docker Desktop with a working engine).

Docker route:

```powershell
Copy-Item .env.example .env
# Set unique DB_PASSWORD, BOOTSTRAP_PASSWORD and BOOTSTRAP_MD_PASSWORD in .env.
docker compose up --build
# Open http://127.0.0.1:5080
```

Native route, terminal 1:

```powershell
$env:ConnectionStrings__Dispatch='Host=127.0.0.1;Port=5432;Database=dispatch;Username=dispatch;Password=YOUR_PRIVATE_PASSWORD'
$env:BootstrapPassword='YOUR_UNIQUE_ADMIN_PASSWORD'
$env:BootstrapMdPassword='YOUR_DIFFERENT_MD_PASSWORD'
$env:MigrateOnStart='true'
$env:ASPNETCORE_ENVIRONMENT='Development'
$env:ASPNETCORE_URLS='http://127.0.0.1:5080'
dotnet run --project src/Dispatch.Api
```

Terminal 2:

```powershell
cd web
npm ci
npm run dev
# Open http://127.0.0.1:5173; Vite proxies /api to port 5080.
```

The isolated tools used during this build are temporary and are not a replacement for installing the prerequisites on another workstation. PostgreSQL must be UTF-8 for production multilingual content.

## 3. Register and label packed cartons

Open Packed registration. Describe physical groups, carton count and actual product/quantity/unit per carton. Choose general stock or a customer assignment. A draft save validates the whole submission. Reopening a draft retains its version; conflicting edits return an explicit reload error. This stage uses explicit draft saves rather than unattended autosave.

For imports, download the CSV template, keep SKU cells as text, upload CSV or .xlsx, review every error, and commit only when the entire import passes. .xls/.xlsm and formula/rich-value cells are rejected. For individual cartons use a unique group and count 1. Repeating the same transport request is idempotent; deliberately importing an identical file with a new request creates a new draft and is a known pending duplicate-file control.

A Packing Supervisor compares actual boxes and physical group markings, then approves. The approval expands groups into unique carton IDs once. Print all selected IDs in a single A4 PDF job. Default labels are 90 × 50 mm with a 34 mm QR and quiet zone, two columns/five rows per A4 sheet. Print the test page at Actual size/100%; disable Fit to page. Check clipping and scan quality on the actual printer.

After physically attaching labels to matching boxes, record attachment. A supervisor scans each current QR and confirms identity/actual contents. Only verified, attached, unheld cartons can be allocated. Duplicate physical copies of the same static QR cannot be distinguished by software; control spare/damaged labels physically.

Reprints retain the same ID/revision. Record a reason and print status honestly. Printer submission or PDF download is not physical print confirmation. An unloaded/unallocated content correction creates a new revision and requires a new label and verification. Physical repacking retires the old identity and creates linked replacements; the API enforces exact content conservation. The first UI exposes lookup/holds, while revision/repack operations are available through the documented command API and require a friendlier editor in a later stage.

## 4. Scanner workstation

Use the actual D-5015 manual and supplied receiver/Bluetooth mode. Verify one scan in a plain text field. Configure supported keyboard/HID LIVE transmission and Enter termination. Do not use its offline/inventory storage mode for dispatch. Do not invent programming-barcode settings from another scanner model.

Use local PC speakers. Select a customer shipment, enter the fixed workstation name, and press Start Loading & Enable Sound. Test the speaker. Keep the dedicated scan field focused. Scan one physical carton, then wait for the server-confirmed result before the next. Green + accepted sound follows a committed acceptance. Amber Duplicate changes no totals. Red Rejected requires correction. Pending means no known acceptance; set the carton aside and reconcile its original request ID.

If the browser refreshes/crashes, reload saved state, explicitly restart/unlock sound and resolve any stored uncertain request before switching shipment. Do not remove the pending-envelope browser entry to make an uncertainty disappear. Expired sessions require login. Paste is blocked in live loading; timing is not treated as proof of scanner identity. The app cannot infer scanner radio health/battery or control arbitrary decode tones through generic HID.

## 5. Allocate, load and approve

Create a vehicle trip and independent customer shipments. Select the exact verified cartons in the subset leaving today. Others remain available. A trip may contain several customers; one customer's carton is rejected in another customer's loading session. Cartons are never partially dispatched by editing a sealed box quantity.

An authorised Unload action removes that carton and all quantities operationally, with a compensating audit event. After load approval/invoicing, use a controlled correction. Unposted reserved shipments can be cancelled and reservations released after every loaded carton is physically unloaded. Vehicle edits are audited through the updateTrip API before departure.

## 6. Billing and separate Tally PC

Approve the exact physical load. Billing staff enter available authorised rates, discounts, freight, charges and source/reason. Editing makes a new revision and removes current approval. Review and approve that revision. Create a durable posting job; the present implementation intentionally records Blocked because the accounting contract is not yet established.

Publish connector:

```powershell
./scripts/publish-connector.ps1
./artifacts/connector/Dispatch.Connector.exe --pair
./artifacts/connector/Dispatch.Connector.exe
```

Create pairing in Settings for the exact isolated TEST company. On the Tally PC, enter the cloud HTTPS URL, connector ID, exact test-company name, loopback endpoint and hidden pairing key. The key is protected with CurrentUser DPAPI. Run under the same Windows account. A scheduled user task is suitable for trial diagnostics. A Windows service under another account cannot decrypt that user's key without a deliberately designed account/deployment policy.

Open Tally with the exact intended test company loaded. Enable XML/HTTP according to the installed version's real configuration. Loopback port is commonly 9000, but verify it. No public inbound Tally/database port or desktop sharing is needed. Heartbeat failure diagnoses stopped Tally, wrong company, unreachable endpoint, unsafe XML or cloud connectivity. Native version/capability and GUID verification require the actual installation.

Ask the accountant to export representative correct invoices (sale, applicable GST, discount, freight) and return/credit vouchers from that test company. Validate master IDs/names, units, dates, numbering, stock effects and marker readback. Implement and fixture-test the contract adapter before enabling production Create. CREATED=1 or HTTP 200 alone is insufficient. A timeout after send means ConfirmationUnknown and review, not another Create.

## 7. Driver documents, departure and returns

Packing lists are operational PDFs, never tax invoices. Confirmed-invoice printing is blocked until genuine voucher readback and an approved output method/layout exist. For a future genuinely confirmed job, record prepared/submitted/failed/unknown/operator-confirmed print status and applicable manually verified statutory references. Failure to print must reprint the existing invoice, never make a second sale. Departure requires every remaining customer's confirmed invoice and document gates.

Post-departure returns reference the original shipment/carton and actual returned quantities, reason and condition. They start in quarantine. Cumulative returns cannot exceed original quantities. QC may select disposal or awaiting accounting restock. Original outbound identities never become available again. Accounting credit/restock and replacement identities after verified return accounting remain pending integration stages.

## 8. Backups, recovery and scale

Set a managed PostgreSQL backup/PITR policy appropriate to the agreed trial/production RPO and RTO. Retain encrypted daily backups and restrict access. scripts/backup.ps1 creates a custom-format pg_dump archive and checksum. scripts/restore-test.ps1 restores only to a newly named disposable database. Verify carton counts, audit counts, request outcomes and billing/job hashes before switching an environment. Never restore or recreate a Tally voucher automatically because a cloud or Tally backup is older.

Keep logs bounded and private. Include correlation IDs in bug reports. The application does not enable EF sensitive-data logging. Monitor database space, long/blocked company transactions, job age, connector heartbeat, stale master snapshots and unresolved scan requests. Run load tests against an isolated API/database, never against live Tally.
