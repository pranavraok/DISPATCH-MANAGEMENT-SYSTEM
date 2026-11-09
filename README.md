# Electro Group of Industries — Dispatch Management System

This repository contains the Dispatch application and its TallyPrime connector, configured as separate company sites. Electro uses an order-first workflow; Aromazen uses a pack-before-order workflow. The current public demos run on Render, while Vercel configuration remains in the source repository. Keep the companies' databases, users, and connector profiles separate. Electro's API supports the Tally connector; Aromazen's Tally master import and invoice posting are not enabled by the current API implementation.

**Current demo sites (Render Free):** [Electro](https://electro-group-dispatch-demo.onrender.com) | [Render dashboard](https://dashboard.render.com/web/srv-dbo1q995efls73clcskg)

[Aromazen](https://aromazen-india-dispatch-demo.onrender.com) | [Render dashboard](https://dashboard.render.com/web/srv-dbo1qdp5efls73cld98g)

**Electro health:** [API health](https://electro-group-dispatch-demo.onrender.com/api/health) returned HTTP 200 and database connected on 8 Nov 2026, but `postingEnabled` was `false`; Tally invoice posting was not ready at that check.

**Aromazen status:** its Render site is deployed, but a connection to its own database has not been verified. The Neon account connected during setup exposed Electro projects only. Never point Aromazen at Electro's database.

**Vercel status:** GitHub showed failed checks for both Vercel projects with “Account is blocked.” These checks are separate from Render's status. Vercel configuration remains in the source repository.

**GitHub repository:** <https://github.com/pranavraok/DISPATCH-MANAGEMENT-SYSTEM>  

**Electro company/workflow:** `ELECTRO GROUP OF INDUSTRIES` | order first

**Company scope:** This README's Tally instructions apply to Electro. Keep Aromazen's site/profile (`DispatchSite=aromazon`), database, users, and connector separate; never share Electro customer/product data, Tally credentials, or invoice mappings.

This guide is for operators, the accountant, and developers. It documents the current source behavior and demo hosting status last checked on 8 Nov 2026. Hosting, database, connector, accounting, product tax, and Tally settings can change; verify them in the relevant dashboards before operational use.

## 1. The four-step daily process

The Electro home page shows the current order and a four-step progress bar. A new order can be started while another order is underway. Earlier orders stay in **Past orders**.

1. **Order & boxes** — enter the purchase-order reference, choose the customer, confirm the delivery destination, and describe the number of boxes and their contents. A box group means that every box in that group has the same contents. Add more than one product to a group for mixed products in the same box. Use another group for boxes with a different mix.
2. **Labels** — saving the order creates its box records and opens label printing. Print the Dispatch QR labels, attach each label to the matching box, then confirm the labels and contents. This is the one physical label confirmation in the flow; there is no separate pack-checklist page.
3. **Scan** — the connector prepares the order shipment after all boxes are label-confirmed. Select that shipment, start scanning, and scan each Dispatch box QR once while loading. Wait for the saved result before scanning the next box. Product barcodes do not identify a Dispatch box.
4. **Bill** — review quantities, current Tally prices, customer/state, GST, charges, and total. Save changes, obtain the required approval, then create the sales invoice in Tally. The connector sends the voucher and checks it back from Tally. A voucher number and **Confirmed/Completed** status mean readback succeeded. Only then can the confirmed invoice PDF be viewed, downloaded, or printed.

The invoice does not require vehicle number, driver, or logistics fields in the simplified Electro flow. The app may keep internal shipment records to coordinate loading and history, but those details are not required to create the invoice.

### What the app means by “Tally connected”

The browser application and cloud database can be connected while the Tally PC is offline. In that case, saved work remains accessible, but the Tally snapshot may be stale and invoice creation must wait. The connector heartbeat is expected about every 15 seconds while Tally is reachable. Electro product/customer masters are refreshed about every two minutes. The browser refreshes saved state periodically and also has a manual refresh button.

The Electro demo health endpoint is [`https://electro-group-dispatch-demo.onrender.com/api/health`](https://electro-group-dispatch-demo.onrender.com/api/health). It reports API, database, site, and current invoice-posting readiness. On 8 Nov 2026 it returned HTTP 200 with `database: Connected` and `postingEnabled: false`. That confirms API/database availability only; it does not mean the Tally connector is paired, the invoice mapping is validated, or a voucher was created. For a real invoice, check its own **Confirmed/Completed** status and voucher number in Tally.

## 2. Tally data and accounting behavior

### Tally is the master source

For Electro, the connector reads stock items and customer ledgers from the exact Tally company. The app uses the latest synced Tally item name, native ID, unit, booked balance, standard selling price, HSN, and GST rate. It also uses customer ledger IDs, names, GSTIN, address, and state where Tally supplies them.

If an item or customer is changed or removed in Tally, the next successful sync updates its linked Dispatch record. A removed master is not offered for new work, while references needed by old order history are retained. Creating a customer or product in the Dispatch app does not create a Tally master. Add masters in Tally, then allow the connector to sync them.

The synced Tally price is the default for billing. A price or discount entered for one Dispatch bill is an invoice-specific value; it does not change the product’s standard selling price in Tally. If the standard price is changed in Tally, the next master sync supplies the changed value.

### What changes Tally stock

Scanning a box records the physical loading event in Dispatch. It does not, by itself, change Tally booked stock. An approved sales invoice is sent to Tally as a sales voucher containing the invoice’s stock lines, quantity, unit, rate, discount, and tax information. Tally then applies its own voucher and inventory configuration. The connector reads the voucher back and compares its identity, lines, quantities, amounts, and taxes before the app marks the invoice confirmed.

If Tally reports insufficient booked stock, check the stock balance for that exact item in the exact Tally company. The app does not silently increase stock to make an invoice pass. A physical count and Tally booked balance are different records and must be reconciled deliberately.

### GST, HSN, and destination checks

Before a customer invoice can be queued, the app checks current Tally item HSN/GST details, customer ledger, sales ledger, and output tax ledgers. The accountant’s confirmed product HSN codes and GST rates must be present in Tally and appear in a fresh connector sync. The app derives local versus interstate supply from the Tally company state and customer state: it uses CGST/SGST for a local supply or IGST for an interstate supply. The destination must contain a state matching the customer ledger state; city-only or conflicting destinations are blocked rather than guessed.

Freight and other charges are optional. The current invoice mapping allocates a taxable charge over the invoice’s GST-rate mix and uses the configured Tally forwarding-charges ledger. Have the accountant verify the ledger and tax treatment for the company before changing that policy.

TallyPrime Educational Mode restricts voucher dates. The app cannot bypass that restriction. If Tally rejects an invoice date, follow the date limitation shown in Tally or use a licensed edition for ordinary daily invoicing.

### TallyPrime setup checklist for Electro

Complete this with the accountant in the `ELECTRO GROUP OF INDUSTRIES` company before enabling normal customer invoicing. Menu wording can vary slightly by TallyPrime release; use **Alt+G (Go To)** to find the named screen if a path differs. Make a normal company backup first. Enter only the company’s real statutory and accounting information; do not use sample GSTINs, sample addresses, or guessed opening stock.

#### 1. Confirm the company and GST registration

1. Open the correct company and confirm its name is exactly `ELECTRO GROUP OF INDUSTRIES` and its registered state/address are correct.
2. Press **F11 (Features)** and set **Enable Goods and Services Tax (GST)** to **Yes**.
3. Open the Company GST details and verify the registered state, real GSTIN/UIN, registration type, and applicable return settings against the company’s GST registration and accountant’s instructions. Do not copy the customer’s state into the company record.
4. Save with **Ctrl+A**. Use e-Invoice/e-Way Bill options only if the company is legally required and the accountant has configured the required details.

#### 2. Verify all 25 stock item masters

Use **Alt+G → Alter Master → Stock Item**, or **Gateway of Tally → Chart of Accounts → Stock Items**. Open each existing item; do not create duplicate items just to add tax information.

For each item, the accountant should verify and save:

- **Name and unit:** preserve the exact existing Tally item name and base unit (for example `Nos`). Dispatch invoices use the Tally item and unit that were synced.
- **GST applicability:** set to **Applicable** for taxable goods.
- **HSN/SAC and GST rate:** use **Use GST Classification** or the item’s own details according to the company’s existing practice. Confirm that the classification resolves to the expected HSN and rate when viewing the item. The accountant has advised this project that all listed items are 18%, with HSN families: heaters `85168000`, temperature sensors `90251990`, relays `85364900`, and temperature controller `90321090`. Apply a family code only to the matching products and verify each product against the accountant’s classification before saving.
- **Standard selling rate:** if the app should prefill Tally’s usual rate, set a dated **Standard Selling Price** for that item and the correct unit. Rates can vary by product and effective date; never copy one item’s rate to all products. The app uses the latest synced standard rate as its bill starting point, while a bill-specific approved rate does not change the master rate.
- **Opening/booked stock:** verify the actual available quantity per item and unit. Dispatch checks Tally’s booked closing balance when creating an invoice. A physical count is not automatically the same as Tally’s booked balance. Record an opening balance or stock adjustment only through the accountant-approved inventory procedure, with the real count and effective date.

Save each altered master and wait for the next connector master sync. A classification label or rate typed in a screen is not confirmed until the saved master is visible in the latest Dispatch sync.

#### 3. Verify customer ledgers and delivery addresses

Use **Alt+G → Alter Master → Ledger** (or **Chart of Accounts → Ledgers**) and open each existing customer ledger. Customer ledgers must be under **Sundry Debtors**. Keep the real ledger name unchanged so it matches the customer selected in Dispatch.

For every customer, verify the party’s actual mailing/delivery address, state, country, and GST registration type/GSTIN where applicable. A state is required for the app to decide local CGST/SGST versus interstate IGST; city-only addresses are insufficient. Save the ledger and allow a fresh Tally sync. Dispatch can prefill the synced Tally address, and an order-specific alternate destination must still be the customer-confirmed full address including state.

#### 4. Verify the sales and tax ledgers used by invoices

Open **Chart of Accounts → Ledgers** (or use **Alt+G → Alter Master → Ledger**) and verify these existing ledgers before creating new ones:

- **Sales ledger:** select the accountant-approved sales ledger under **Sales Accounts**. Its exact spelling must appear in the latest Dispatch Tally sync; select that exact current name in **Settings → Tally settings for the accountant**. Do not use an archived or `DEMO` ledger.
- **Output CGST, output SGST, and output IGST:** the current production validator requires one unambiguous ledger for each tax type under **Duties & Taxes**. Each must be configured as **Type of Duty/Tax: GST** and the matching tax type (Central, State, or Integrated). They must be output-tax ledgers for sales, not input/purchase GST ledgers. Keep the accountant-approved ledger names; the app identifies the tax roles from the synced ledgers.
- **Forwarding Charges:** if freight or other pre-tax charges will be used, verify that the ledger named exactly `Forwarding Charges` exists and that the accountant has approved its group and GST treatment. Otherwise leave those optional charge fields at zero. Do not create a differently named ledger and assume the app will map it.

Save ledger changes and sync again. In Dispatch, select the latest synced Sales Accounts ledger, save the Tally settings, and have an Admin/Billing administrator validate the Electro production invoice mapping. Saving mapping settings clears prior validation, so validate after the final change.

#### 5. Enable the local Tally integration on the Tally PC

On the Windows PC that runs TallyPrime, open **F1 (Help) → Settings → Connectivity** or **Advanced Configuration**, depending on version. Configure the HTTP/XML server as **Server** (or **Both** if that is the available operating mode), confirm port `9000` or the port deliberately selected for this installation, and enable ODBC if the connector setup requires it. Keep the endpoint local to the Tally PC (`127.0.0.1`); do not expose port `9000` on the router or public Internet. Keep the correct Electro company open while syncing or posting.

The connector is a Windows-side bridge between the cloud app and Tally’s local XML/HTTP service. Pair it once in Dispatch Settings, run it under the same Windows account used for pairing, and keep it running while Tally is expected to sync or receive invoices. The app does not directly reach into Tally from the public website.

##### Accessing Tally from the client site or from another laptop

There are two separate kinds of access:

- **Using the Dispatch website:** If the site is publicly deployed and you have an authorized account, you can open it from your own laptop over the Internet. You do not need to be on the client's Wi-Fi just to use the website.
- **Connecting the app to Tally:** The Dispatch connector must run on a Windows PC that can reach the client's TallyPrime installation. In the usual setup, keep Tally and the connector on that client/factory PC, keep the correct company open in Tally, and let the connector reach the cloud site over outbound HTTPS. The connector talks to Tally locally on that PC; the website does not connect directly to Tally.

You can administer the Tally PC from another location only if the client's IT administrator has arranged authorized remote access, such as a company VPN or secured remote desktop. A pairing key or the website URL does not grant remote access to the client's PC. Do not expose Tally's HTTP/XML port (commonly 9000) directly to the public Internet. If initial setup requires hands-on access, use the client's PC or have their IT administrator provide a secure remote session.

#### 6. Refresh, validate, and perform the first real posting carefully

1. Keep Tally open to the exact Electro company and the connector running.
2. In Dispatch **Settings → Tally PC connections**, wait for a recent heartbeat and successful master sync. Check that the company name, all expected product names/units/HSN/GST/rates/stock balances, customers/states, and accounting ledgers match Tally.
3. In **Settings → Tally settings for the accountant**, select the exact Sales ledger from the latest sync; set the voucher type to the company’s actual Sales voucher type; save.
4. Have the administrator/accountant review the company and output tax mappings, then run **Validate Electro production invoice setup**. Resolve every failed validation in Tally and repeat the sync/validation. A green connection badge alone is not validation.
5. For a live customer order, check quantities against actual available stock, full destination/state, Tally rates, HSN/GST, discounts, and charges. An approved invoice request posts to the connected Electro books; do not use an order called TEST for a customer sale. After posting, verify **Confirmed/Completed**, voucher number, exact Dispatch reference, and readback invoice in both Dispatch and Tally.

Tally’s own reports remain the authority for booked stock and accounting. The app’s sync is periodic (normally about every two minutes), so an edit in Tally appears after the next successful sync rather than immediately. Product/customer master changes flow from Tally to Dispatch; approved Dispatch invoices flow to Tally. Bill-specific price/discount overrides do not rewrite the Tally item master.

Official Tally help: [Set up company GST](https://help.tallysolutions.com/set-up-gst-details-in-company/), [set up stock items for GST](https://help.tallysolutions.com/set-up-stock-items-for-gst/), [set up GST tax ledgers](https://help.tallysolutions.com/set-up-tax-ledgers-for-gst/), [set up a party/customer ledger](https://help.tallysolutions.com/set-up-party-ledger/), [set standard selling prices](https://help.tallysolutions.com/selling-buying-prices/), and [configure XML/HTTP integration](https://help.tallysolutions.com/xml-integration/).

### Safe invoice status handling

An invoice job can move through states such as `Queued`, `Claimed`, `Sending`, `ConfirmationUnknown`, `NeedsReview`, `Rejected`, and `Confirmed`.

- `Claimed` means the connector has picked up the request. It does not mean the voucher was created.
- `Confirmed` means the connector found exactly one voucher by the Dispatch reference and validated its readback. The voucher number is shown in Billing.
- `ConfirmationUnknown` or `NeedsReview` means the result must be reconciled. The connector does not automatically resend an uncertain invoice.
- Before any authorized retry, search Tally for the exact Dispatch reference. Never click retry just because a row is slow or missing a document; a second voucher could duplicate a sale.
- A confirmed Tally voucher is not deleted by deleting or cancelling a Dispatch order. Corrections, credit notes, and accounting reversal must be handled with the accountant in Tally.

## 3. Using each application page

On the Electro site, the sidebar keeps the regular work simple. The four-step guide opens the detailed work screens as needed.

### Dispatch

This is the home page and the starting point for an order. Choose an open order from the selector, read the customer/reference/address/box summary, and follow the current next-step button. **Start another order** opens order entry without erasing the current order. Use the browser/site refresh control to reload saved state if it looks stale.

### Past orders

This page lists current and earlier customer orders. Use **New order** to create another PO. Earlier order, box, scan, and invoice history stays available. An open order may be cancelled with a reason and typed PO-reference confirmation; cancellation preserves the history. An order with packing or shipment history cannot be hard-deleted as though it never existed. Tally invoices are separate and remain in Tally.

### Order entry and box contents

Complete the required order reference, customer, and complete delivery destination. The destination is prefilled from the selected customer’s Tally address when available; verify it for this delivery and include the state. If the Tally address is a placeholder or incomplete, correct the customer ledger in Tally and wait for sync, or enter the customer-confirmed address for this particular order.

Set the count for each box group. Add each product in that mix and its quantity **per box**. For example:

| Group | Boxes in group | Product entries | Meaning |
| --- | ---: | --- | --- |
| A | 2 | Immersion Heater 1000W: 3 Nos; J-Type Thermocouple: 1 No | Both products are inside each of the two boxes |
| B | 1 | Temperature Controller: 2 Nos | One box has only this group’s mix |

The order total is 3 boxes. Group A’s total item quantities are multiplied by two; Group B is counted once. Mixed-product contents belong in one group when the boxes repeat that same mix. Use a separate group when the mix differs. Do not enter the order total as a per-box quantity.

Select **Save order** once. For new Electro orders the server saves the order, box groups, packing record, and box identities together, then the browser opens label printing. If the save succeeds but the page cannot switch because an unresolved scan is being recovered, the order is still saved; return to Dispatch and continue it there.

### Labels — print, attach, confirm

The label screen lists Dispatch box records. Select the boxes to print and choose **Print selected**. The browser creates the QR label PDF; choose the actual printer in the print dialog. Check paper size and scaling before a full print run. Attach each label to its matching physical box. Then select the corresponding unconfirmed boxes and choose **Confirm labels & contents**. This confirmation is made by an authorized packing supervisor and records the checked label revision and operator.

Use the QR printed by Dispatch. A product EAN/UPC barcode, product QR, PO number, or typed carton code is not a substitute. If a box is repacked or its contents are revised, its revision/label must be updated and checked again. Keep spare or damaged printed labels controlled; software cannot distinguish two physical copies of the same QR.

The Labels area also contains **Scan for dispatch**. The four-step guide opens it at Step 3. A barcode scanner in keyboard/HID mode types into the focused scan field and normally sends Enter at the end. Keep the field focused. Scan one box, wait for the on-screen result and sound, then continue. A green accepted result changes the saved totals. An amber duplicate does not add to totals. A red rejection means the box is not accepted for that selected shipment. Scans require the correct shipment and network connection; do not scan against an unrelated order.

If the browser reports an uncertain scan after a connection interruption, resolve the original saved request before switching shipments or scanning the physical box again. The app preserves the request identifier so it can reconcile the result without double-loading a box.

### Billing

Billing becomes available after all boxes in the shipment are loaded and loading is approved. Review the customer, destination/state, products, quantities, Tally standard prices, HSN/GST, discounts, freight, other charges, terms, and estimated total.

- Tally standard prices are prefilled when available. Confirm the selling rate for this customer.
- Item discount applies to this invoice only; it does not edit the Tally item master.
- Freight, other charges, terms override, and price/terms note are optional. Leave terms blank to use the standard invoice copy. A note is needed only when a price/terms explanation is actually required.
- **Save changes** saves a new billing revision. Changing bill details removes approval of the old revision; review and approve the revised bill again.
- Approve only after checking the customer, destination, loaded quantities, item rates, tax and total. Then select **Create sales invoice in Tally** once.
- Wait for the job to become **Confirmed/Completed** and show a voucher number. Open **View, download & print invoice** to see the copy, download the PDF, or print it. The app’s invoice PDF is generated from Tally-confirmed readback, not from an unconfirmed draft.
- If the statutory-reference option is enabled in Settings, enter the actual applicable reference at the document/departure prompt. Do not invent a reference. Ask the accountant which reference applies if unsure.

### Settings

Settings contains four areas:

1. **Customers & products** — Electro’s records are synchronized from Tally and shown with their IDs, names, HSN/GST, address/state, price, and balance when available. Use Tally to add or edit company masters. Removed Tally records stay visible when old work needs them but are unavailable for new work.
2. **Scanner & printers on this computer** — save a workstation name for the scan station. The physical scanner behaves as keyboard input. Choose the printer in the browser dialog; printing happens on the operator’s computer.
3. **Tally settings for the accountant** — exact company name, version, Sales voucher type, exact Sales Accounts ledger, notes, and statutory-reference requirement. Saving a mapping change invalidates prior validation. The accountant/admin must validate the current production mapping again before posting.
4. **Tally PC connections** — view pairing, company name, heartbeat, latest master sync, diagnostics, and Disconnect. Disconnect revokes the cloud credential; it does not erase historical invoices from Tally.

Admins can also create named users and assign roles in Settings.

### More: reports and returns

**Reports** shows saved operational/audit data for the selected company and workflow. **Returns** records a returned box and its actual product quantities, reason, and condition. Returned goods begin in quarantine. A return does not automatically create a Tally credit note or restock entry; the accountant must handle any accounting movement in Tally.

## 4. Tally PC connection — setup and normal operation

The connector must run on the Windows PC where TallyPrime is running. The browser is not the connector. The connector makes outbound HTTPS calls to Dispatch and loopback HTTP calls to Tally on the same PC; no public port-forwarding of Tally or PostgreSQL is required.

### One-time setup

1. **Check Tally:** open `ELECTRO GROUP OF INDUSTRIES` in TallyPrime. Enable the Tally XML/HTTP integration for the installed Tally version. The connector uses `http://127.0.0.1:9000`; confirm the actual Tally port is 9000 and its server is reachable from the same PC. ODBC should be enabled if required by the installed Tally configuration. Never expose port 9000 to the public Internet.
2. **Create the pairing in Dispatch:** sign in as an administrator, open **Settings → Tally PC connections → Connect a Tally company**. Use the exact company name `ELECTRO GROUP OF INDUSTRIES`. Copy the connector ID and one-time pairing key securely. The key may only be displayed once; if lost, revoke and create a new pairing.
3. **Publish or copy the connector:** build the self-contained Windows connector using the repository’s .NET 10 SDK and `scripts/publish-connector.ps1`, or use the approved connector package already provided for the Tally PC. Copy the published `Dispatch.Connector.exe` and its required runtime files onto that PC.
4. **Pair it:** open PowerShell in the connector folder and run:

   ```powershell
   .\Dispatch.Connector.exe --pair --profile electro
   ```

   Enter the website's base HTTPS address, for the current demo `https://electro-group-dispatch-demo.onrender.com` (do not add `/api`); the connector ID; the exact Tally company; `http://127.0.0.1:9000` if that is the verified port; and the one-time pairing key at the hidden prompt.

   Pairing checks that the website is the Electro site and that the Tally endpoint is loopback. The credential is protected with Windows Current User DPAPI. Run the connector under the same Windows account that performed pairing.
5. **Start it:** run `Dispatch.Connector.exe --profile electro`. Leave Tally open to the exact company and keep the connector PC online. The Settings page should show a recent heartbeat and a successful master-sync diagnostic. After a successful setup, configure Task Scheduler to start the connector at that Windows user’s sign-in if it is not already configured. Do not start multiple copies; a local lock prevents parallel connector instances.
6. **Check setup in Dispatch:** wait for master sync, confirm customers/products and the accountant-approved ledger choices, then use **Validate Electro production invoice setup** only after the accountant/admin has checked the exact company and ledgers.

The connector may continue automatically after Windows sign-in if Task Scheduler or the workstation’s approved startup mechanism has been configured. If Tally or the PC is off, no live Tally read or invoice posting can occur; it resumes on the next successful connection. To disconnect, use **Settings → Tally PC connections → Disconnect**. Revoking the pairing blocks future cloud calls from that connector. Pairing a replacement connector does not delete Tally vouchers already created.

### What is synchronized and how often

While running, the connector checks company reachability and sends a heartbeat. About every two minutes it exports stock items and ledgers and sends the latest Electro master snapshot to the cloud. The snapshot is scoped to the exact company and includes item identifiers/names/units/stock balance/prices/HSN/GST and customer ledger information. New or edited Tally masters therefore appear after the next successful sync. This is periodic pull-from-Tally synchronization, not an instant two-way master editor.

For an invoice, the app freezes an approved billing payload with a unique Dispatch reference. The connector checks that payload hash, reads the exact Tally company and current masters, searches Tally for the reference, imports the voucher only when safe, then searches again and validates the voucher. If the connector loses the response after sending, it reconciles by reference and does not blindly create another voucher.

## 5. Roles and approval boundaries

Server-side permissions are enforced by the API; hiding a button in the browser is not the security boundary.

| Role | Typical work |
| --- | --- |
| Admin | Manage users and connectors; can perform operational roles |
| PackingClerk | Prepare and print packing labels |
| PackingSupervisor | Confirm labels/contents and supervise packing changes |
| Loader | Start a loading session and scan boxes |
| DispatchSupervisor | Manage order/dispatch actions and approve loading |
| Billing | Review/save/approve bill, manage Tally mapping, queue invoice |
| MD | Read-only reporting/dashboard access |

Some steps require more than one role. For example, **Confirm labels & contents** requires Admin or PackingSupervisor, and invoice creation requires Billing privileges. Ask an Admin to assign only the role needed for a person’s work.

## 6. Application and data architecture

```text
Operator browser (React / TypeScript)
        │ HTTPS, session cookie + CSRF token
        ▼
Electro API (ASP.NET Core 10, hosted in the current Render demo container)
        │ EF Core / Npgsql
        ▼
PostgreSQL (company-scoped operational state, audit, request/outbox)

Tally PC connector (Windows .NET app)
        ├── outbound HTTPS ──► Electro API
        └── HTTP loopback ────► TallyPrime XML/HTTP at 127.0.0.1:9000
```

### Frontend

- `web/src/main.tsx` — application startup, authenticated session restoration, routing/sidebar, saved-state refresh, and Electro’s four-step guide.
- `web/src/workflow-ui.tsx` — order editor, grouped/mixed box contents, customer/product view, workstation settings, and related workflow controls.
- `web/src/screens.tsx` — label printing and confirmation, billing, Tally settings, trips, reports, returns, and other screens.
- `web/src/scanner.tsx` — live scanner input, one-box-at-a-time feedback, saved scan recovery, and audio prompts.
- `web/src/api.ts` — same-origin API client, session/CSRF handling, and command request envelopes.
- `web/src/labels.ts` — browser-generated label, packing-list and confirmed-invoice PDFs.
- `web/src/domain.ts`, `web/src/work.ts`, and `web/src/workflow.ts` — typed data and client-side workflow calculations/selection.

The browser shows user-facing state; the API is authoritative. A page refresh re-reads from the server. The scan client stores only the request envelope needed to recover an uncertain result, not the source of truth for inventory.

### Backend and connector

- `src/Dispatch.Api/Program.cs` — ASP.NET startup, configuration, migrations, authentication routes, state/read/document endpoints, connector endpoints, and health reporting.
- `src/Dispatch.Api/Operations.cs` — command validation, role checks, order/billing/Tally mapping/approval operations, and audit records.
- `src/Dispatch.Api/Workflows.cs` — order creation, exact box-group validation, and automatic OrderFirst shipment preparation.
- `src/Dispatch.Api/Domain.cs` — database entities and typed invoice/master data.
- `src/Dispatch.Api/WorkQueries.cs` — scoped detail loading for a packing list, shipment, or trip.
- `src/Dispatch.Api/TallyMasterSync.cs` — applies exact-company product and customer snapshots to linked records.
- `src/Dispatch.Api/CartonCodes.cs` — unique, revision-aware Dispatch QR encoding/decoding.
- `src/Dispatch.Connector/Program.cs` — Windows connector pairing, DPAPI storage, Tally XML communication, periodic master sync, durable invoice-attempt journal, and invoice readback.

PostgreSQL stores companies, users/sessions, customers/products, orders, box manifests, cartons, shipments/allocations, loading sessions, billing revisions, connector state, invoice jobs, label jobs, returns, requests, audit events, and the audit-feed outbox. Mutations are company-scoped, versioned/idempotent where required, and committed with their saved outcomes. Carton identifiers and invoice references are unique; stale carton revisions and cross-company records are rejected.

### Main API routes

All browser API calls are same-origin under `/api`.

| Route | Purpose |
| --- | --- |
| `GET /api/site` | Returns the fixed company/workflow site profile |
| `GET /api/health` | API/database health and current Electro posting readiness |
| `POST /api/auth/login` | Creates an HttpOnly session cookie |
| `GET /api/auth/me` | Restores the signed-in user and CSRF token |
| `POST /api/auth/logout` | Ends the current session |
| `GET /api/state` | Loads company-scoped current state; carton lists can be paged/searched |
| `GET /api/work/{kind}/{id}` | Loads detailed related work for packing, trip, or shipment |
| `POST /api/commands` | Applies a validated business command, such as create order, approve bill, scan, or queue invoice |
| `GET /api/requests/{id}` | Recovers the saved response to a command request |
| `GET /api/documents/invoice/{shipmentId}` | Returns a confirmed Tally voucher snapshot for PDF generation |
| `/api/connector/*` | Authenticated connector heartbeat, master sync, invoice claim, send acknowledgement, and result/readback |

Browser mutations require the session CSRF token. Connector calls use a separate connector ID/key and cannot use a browser session. The connector key is never put in browser code.

## 7. Local development and build

### Requirements

- Windows 10/11, macOS, or Linux for web/API development; the Tally connector itself runs on Windows.
- Docker Desktop with Compose for the simplest local API/PostgreSQL setup.
- For native builds: .NET SDK `10.0.403` (the repository pins the SDK in `global.json`), Node.js 22, and npm.
- A separate isolated database for integration tests. Never point automated test commands at the production database or Tally company.

### Run the complete local app with Docker

1. From the repository root, copy `.env.example` to `.env`.
2. Replace every placeholder password with a unique strong value. Do not commit `.env`.
3. Start the services:

   ```powershell
   docker compose up --build
   ```

4. Open <http://127.0.0.1:5080/>. Use the admin email from `BOOTSTRAP_EMAIL` (default local example: `admin@electrogroup.test`) and the `BOOTSTRAP_PASSWORD` you set. The management user uses the `BOOTSTRAP_MD_PASSWORD` you set and is read-only.
5. Stop with `Ctrl+C`. `docker compose down` stops the containers and retains the named database volume. `docker compose down -v` deletes that local database volume; use it only when you intentionally want to discard local data.

Compose maps PostgreSQL to `127.0.0.1:5432` and the application to `127.0.0.1:5080`. The local database is for development, not a backup of production. Do not pair a development build with the real production Tally company.

### Run the frontend separately

Start the API/PostgreSQL as above. In a second terminal:

```powershell
Set-Location web
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/>. Vite proxies `/api` to the local API on port 5080. To build the frontend for release:

```powershell
npm run build
```

### Build the .NET projects

From the repository root:

```powershell
dotnet build src/Dispatch.Api/Dispatch.Api.csproj
dotnet build src/Dispatch.Connector/Dispatch.Connector.csproj
```

Publish a self-contained Windows x64 connector:

```powershell
./scripts/publish-connector.ps1
```

Output is written to `artifacts/connector/`. The script requires the pinned .NET 10 SDK. The current Render demo container build uses the SDK image specified in `Dockerfile.vercel`.

### Tests and validation

The repository has frontend tests under `web/src`, connector self-checks, and API/integration scripts under `tests`. Use an isolated development/test database and a non-production endpoint only.

```powershell
Set-Location web
npm test
npm run build
Set-Location ..
dotnet run --project src/Dispatch.Connector -- --self-test
```

The API integration scripts need their own test database and credentials, documented in `docs/VALIDATION.md`. Never run fixture or load-test scripts against the production database or a live Tally company. A successful software test does not replace a physical scanner/printer check or an accountant’s validation.

## 8. Demo hosting and release status

The application image is built from `Dockerfile.vercel`: a Node stage builds the React frontend, a .NET 10 stage publishes the API, and the ASP.NET container serves both from one origin. The filename and `vercel.json` are retained for source compatibility; the current public demo services run on Render. PostgreSQL is external to each app container.

### Current Render demos

- **Electro:** [open the site](https://electro-group-dispatch-demo.onrender.com) | [Render dashboard](https://dashboard.render.com/web/srv-dbo1q995efls73clcskg). Its `DATABASE_URL` points to the populated Electro Neon database. Last checked 8 Nov 2026: `/api/health` returned HTTP 200, database connected, and `postingEnabled: false`. Tally posting still requires a reachable paired connector and validated production mapping.
- **Aromazen:** [open the site](https://aromazen-india-dispatch-demo.onrender.com) | [Render dashboard](https://dashboard.render.com/web/srv-dbo1qdp5efls73cld98g). Its own company database has not been configured/verified. The Neon account available during setup exposed Electro projects only. Do not use Electro's database for Aromazen.

Both Render services use the Free plan in Singapore and deploy on commits. Free services can sleep when idle; check Render's current plan limits and service status before a client demonstration. No hosting free tier should be described as permanent.

### Vercel and GitHub status

The repository still contains Vercel deployment configuration, and old Vercel project URLs may remain in deployment history. As shown in GitHub on 8 Nov 2026, checks for `electro-group-dispatch` and `aromazon-india-dispatch` failed with “Account is blocked.” This is a Vercel account/deployment check, not evidence that the application source or Render services failed. Do not use those checks as the Render health signal.

Keep deployment secrets private in the hosting provider's environment settings, not in GitHub or `VITE_*` browser variables. Use TLS for hosted PostgreSQL and limit secret access.

For each release, verify the Render deploy state and `/api/health`. For Electro Tally posting, also verify the connector heartbeat, fresh masters, validated mapping, and the specific voucher readback in Tally.

`MigrateOnStart` is intended for controlled schema migrations. Set it only according to the deployment runbook and database backup/change policy. Bootstrap passwords are initialization credentials, not daily operator logins; disable unnecessary automatic seeding after initial setup and create named users in the app.

### Database retention and backups

The app can report `database: Connected` while the provider still has trial, expiry, or limited backup terms. This repository does not prove a provider’s retention period, free-tier duration, or point-in-time recovery policy. Check the database provider dashboard directly, claim/migrate the database if required, and configure encrypted backups/restore tests. Do not describe the database as “free forever” unless the provider contract says so. The API health check proves current connectivity only.

Backup and restore helpers are in `scripts/backup.ps1` and `scripts/restore-test.ps1`. Restore to a new disposable database, validate row counts and invoice-job references, and get approval before switching production. Never replay an invoice merely because a backup is older; first reconcile the exact voucher reference in Tally.

## 9. Troubleshooting

| What you see | What to check |
| --- | --- |
| “Could not open your workspace” | Check browser/network and `/api/health`; use Try again. A temporary connection failure is not proof the saved session or data was deleted. Sign in again only if the session has actually expired. |
| Settings says Tally disconnected or heartbeat is old | On the Tally PC, open the correct company, confirm Tally integration on port 9000, check the connector process/Task Scheduler, and verify the PC has Internet access. Do not launch a second connector copy. |
| A product/customer is missing or marked unavailable | Refresh Tally master sync; confirm it exists in the correct company and is not archived. The app will not create a corresponding Tally master for you. |
| Destination/state validation fails | Correct the state/address in the Tally customer ledger, wait for the next sync, then choose/fetch the Tally address. For a different delivery site, use the customer-confirmed full destination and state and re-review the bill. |
| Scan says invalid/wrong-company | Scan the Dispatch QR label for a box, not a product barcode. Select the matching shipment and ensure the QR is the current revision and belongs to this Electro company. |
| Scan says duplicate | That box has already been accepted for the shipment. Totals do not increase; do not scan again. |
| Scan result is uncertain after Wi-Fi loss | Leave the physical box aside, recover the original request in the same browser/session, and wait for the saved result. Do not create a new scan request for that box until resolved. |
| “Claimed” invoice seems stuck | Claimed only means the connector picked it up. Keep Tally open and connector running; inspect the invoice status/diagnostic. If it becomes ConfirmationUnknown, search the exact reference in Tally before authorizing any retry. |
| Invoice says insufficient stock | Check the specific item’s booked Tally stock balance, unit, and quantity. Correct Tally stock through the accountant’s approved voucher/count process; the dispatch app will not assume a balance. |
| Save changes did not keep a bill | Check for an inline/server error, refresh and reopen the bill. A successful save produces a new revision and removes previous approval; approve the saved revision again. |
| Invoice PDF is unavailable | The PDF is only available after exact Tally voucher readback is `Confirmed`. A queued or claimed job is not a confirmed invoice. |
| Tally rejects an invoice date | TallyPrime EDU imposes its own date restrictions. The app does not override the license mode; follow Tally’s allowed date or ask about a licensed edition. |

When reporting a problem, include the page, PO reference, shipment or invoice row, exact status/message, local time, and the relevant Render service/deploy ID. If the issue is a Vercel check, include the project name and “Account is blocked” status. Do not send passwords, connector keys, database URLs, or customer private data in a screenshot or support message.

## 10. Important operating controls

- Verify customer, complete address/state, item, quantity, rate, discount, tax, charges, and final total before approving billing.
- A Tally master sync is periodic, not instantaneous. Wait for a fresh sync after editing Tally and review the resulting data.
- The app keeps order, scan, approval, and invoice history. Cancel or correct work through the intended workflow; do not alter the production database manually.
- Tally owns the official voucher and accounting record. Use Tally/accountant workflows for voucher cancellation, credit notes, stock adjustments, and accounting corrections.
- Store the connector’s protected configuration only on the intended Windows account. Revoke the pairing in Settings if the PC/account is retired or credentials may have been exposed.
- Keep production and development databases, connector credentials, and company pairings separate. Never use Electro credentials for another company.
- Retain an agreed database backup and restore process. Do not rely on the deployment container filesystem for records.

## 11. Further technical references

- [Architecture and data boundaries](docs/ARCHITECTURE.md)
- [Operator runbook](docs/OPERATOR_RUNBOOK.md)
- [Workflow/site profiles](docs/WORKFLOWS.md)
- [API contract and command list](docs/API.md)
- [Validation record and known limits](docs/VALIDATION.md)
- [Build checklist](docs/BUILD_CHECKLIST.md)
- [Full implementation specification](docs/MASTER_SPECIFICATION.txt)

The files in `docs/` include historical design and validation notes. If an older note conflicts with the current production behavior described in this README or visible in the live app, confirm the exact deployed revision and health state before following that note.

## 12. Roll out the pack → label → order → dispatch workflow for Aromazen

Aromazen must remain a separate company site. Its current Render demo is <https://aromazen-india-dispatch-demo.onrender.com>, with `DispatchSite=aromazon` and the **Pack before order** workflow. As of 8 Nov 2026, its company-specific database connection had not been verified; the connected Neon account exposed Electro projects only. Do not point Aromazen at Electro's database. The API deliberately accepts Tally master imports and enables production invoice posting only for Electro. This section is a separate-company rollout plan, not a claim that Aromazen is ready for Tally posting.

### Intended Aromazen operator flow

The target is a stock-first flow for already packed goods:

1. **Pack stock:** an authorized Aromazen user records finished goods packed into boxes, with the exact product and quantity in each box. Boxes may contain a mix of products. Save that packing record into Aromazen’s database only.
2. **Print labels:** print a unique Aromazen Dispatch QR label for each box, attach it to the matching physical box, and have an authorized person confirm that the label and recorded contents match. If the contents change, revise and reprint/reconfirm the affected label.
3. **Receive the order:** when a real customer order arrives, enter its PO/reference, select the Aromazen customer, and specify the ordered products/quantities and destination. The app must allocate enough matching, available packed boxes to that order; it must not silently substitute another product mix or allocate a box twice.
4. **Dispatch:** select the order’s allocated boxes, scan each box QR once during loading, review saved scan results, and approve loading. Unallocated Aromazen boxes remain available for later orders.
5. **Invoice (if enabled):** invoice creation is a separate release milestone. Until Aromazen’s own Tally configuration and connector posting path have been implemented and validated, do not show an enabled “Create sales invoice” action for Aromazen. If enabled later, use its own exact Tally company, masters, GST ledgers, rates, approval rules, and voucher readback.

This differs from Electro’s current Order → pack/labels → scan → bill sequence: Aromazen packs finished inventory before an order exists, then assigns those boxes to customer orders later.

### Implementation and launch checklist

1. **Keep the company boundary.** Preserve `DispatchSite=aromazon`, Aromazen’s company ID, domain, database URL, bootstrap credentials, users, connector profile, and branding. Do not point Aromazen to Electro’s production database or reuse Electro’s Tally pairing. Confirm sign-in and database isolation before enabling any workflow action.
2. **Load Aromazen’s own masters.** Enter or sync only Aromazen’s real customer ledgers, products, units, prices, stock, addresses, and statutory details. Every product and customer must match the actual Aromazen books. Do not copy Electro’s heater catalog, customers, GST/HSN values, prices, or stock as defaults.
3. **Keep pack-first behavior and make order allocation explicit.** The order page should search/select eligible packed boxes by their saved contents and availability. Validate that the selected boxes together satisfy order quantities, customer, destination, and any partial-shipment rules. Reserve them atomically when the order is saved; release reservations only through a deliberate cancel/edit path. Prevent duplicate box allocation, cross-order scans, stale label revisions, and over-shipment.
4. **Use Aromazen-scoped labels and scans.** QR payloads and server validation must bind to the Aromazen site/company. The scan screen must show the selected Aromazen order/shipment, accept only its currently allocated box labels, reject Electro or unknown labels, and wait for a persisted scan result before updating the loaded count. Keep report and Past Orders history scoped to Aromazen.
5. **Complete the API and UI company gates.** Extend Tally-master sync and invoice-posting checks only if Aromazen is meant to use Tally. Update the fixed-site readiness checks, company-specific mapping validation, allowed connector endpoints, user/role setup, invoice document branding, and health output. Do not remove the existing Electro production safeguards to make the second company work. Keep company-specific acceptance checks and database constraints in place.
6. **Configure Tally separately if invoicing is required.** In Aromazen’s own Tally company, have its accountant verify company GST registration, customers, product masters/units, actual HSN and rates, actual standard selling prices and booked stock, Sales Accounts ledger, output tax ledgers, and any charge ledgers. Follow the Tally setup checklist earlier in this README, but enter Aromazen’s values only. Create a separate connector pairing with `--profile aromazon`, its Aromazen HTTPS site URL, exact Tally company name, and verified local Tally endpoint. The connector stores a separate Windows-protected credential for that profile. Do not start two Tally instances on the same port unless the accountant/IT administrator has deliberately configured distinct reachable endpoints.
7. **Deploy and verify independently.** Use the Aromazen Render service with `DispatchSite=aromazon` and Aromazen-only secrets/database; connect its correct company database before treating the demo as operational. Apply reviewed database migrations and initialize only the Aromazen company and named users. Verify health, company/site identity, fixed pack-first workflow, login, order/box isolation, scanner flow, history, and access controls. If Tally invoicing is included later, also implement Aromazen's API/connector support and verify fresh master sync, accounting mapping, an accountant-approved controlled voucher, exact-reference readback, and PDF contents before ordinary posting.
8. **Pilot with real operations.** Start with a small real packing batch and one authorized real order. Physically compare each packed box’s contents and QR label, test one scan per allocated box, check remaining stock and order history, and confirm the Tally result if invoicing is enabled. Keep posting disabled if any master, tax, stock, reservation, scan, or voucher check fails.

Release is complete only when the Aromazen user experience, production data boundary, physical label/scan checks, and, if requested, Tally create/readback have all been verified on the Aromazen deployment. Electro should continue to run on its own site and database throughout the rollout.
