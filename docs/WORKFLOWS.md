# Independent company sites

| Company | Site | Workflow | Deployment configuration |
| --- | --- | --- | --- |
| Electro Group of Industries | https://electro-group-dispatch.vercel.app/ | Order first | DispatchSite=electro |
| AROMAZEN PVT LTD | https://aromazon-india-dispatch.vercel.app/ | Pack before order | DispatchSite=aromazon |

The same source code is deployed as two independent Vercel projects. Each project receives its own private DATABASE_URL, bootstrap passwords and company profile. There is no database bridge, shared master list, shared session, shared connector key or workflow switch. The original dual-workflow engine remains available only for development regression tests. Production requires a company profile.

## Electro: Order first

1. Sign in to Electro and add its products and customers in Settings.
2. Record a received customer order, including destination and carton requirement.
3. Pack for that exact order, obtain supervisor approval, print and attach labels.
4. Confirm attachment and contents without scanning.
5. Create a trip, reserve that order's cartons, then scan each carton once in Labels > Scan for dispatch.
6. Approve loading and review billing. Real Tally posting remains disabled pending physical integration and readback validation.

## Aromazon: Pack before order

1. Sign in to Aromazon and add its products and customers in Settings.
2. Record manufactured, packed stock before an order exists.
3. Approve packing, print and attach labels, then confirm attachment and contents without scanning.
4. Receive the customer order later, create a trip and reserve the selected labelled cartons.
5. Scan each selected carton once in Labels > Scan for dispatch, approve loading and review billing. Unselected stock stays available.

Carton counts alone cannot prove an unrecorded product requirement. A label scan retrieves recorded contents; staff must ensure the label matches the physical carton.

## Separate data and existing records

Electro retains its original database. Existing trial records are preserved and backed up before deployment. Legacy StockFirst work is retained there as historical test data but is inaccessible through Electro's fixed OrderFirst site. It is not copied into Aromazon. Aromazon starts with its own company, warehouse, administrators and empty operational/master tables.

The API rejects the other workflow on state reads, detail reads and commands. Login, sessions and connector credentials are bound to the configured company. Startup refuses a database without the matching company identity. Each site serves its own branding and company name on documents.

## The same physical devices

A USB/receiver scanner acts as keyboard input in the focused scan box. Open the correct company site, activate Labels > Scan for dispatch and select its scan box. Avoid scanning while the other company's tab has focus. Select the actual printer in the OS/browser print dialog. Browser workstation preferences and uncertain-scan records are isolated by origin; workstation names are also keyed by company. No hardware duplication is required.

## Separate Tally connector profiles

Use the same connector executable with separate protected local stores and lock files:

- Pair Electro: Dispatch.Connector.exe --profile electro --pair
- Run Electro: Dispatch.Connector.exe --profile electro
- Pair Aromazon: Dispatch.Connector.exe --profile aromazon --pair
- Run Aromazon: Dispatch.Connector.exe --profile aromazon

Each pairing checks the website's company profile and stores its own HTTPS URL, connector ID, DPAPI credential, exact Tally company name and local endpoint. Pairing one profile cannot overwrite the other. Distinct service names are supported if installed later. Use separate Tally endpoints/instances where needed; the connector always checks the exact configured company. Electro production invoices are gated by the approved bill, current master data, the exact company, the Tally import result and exact-reference readback. A real Tally create/readback still needs on-site verification. Aromazen is unchanged.

## Verification

61 frontend tests pass, including fixed-dashboard URL tampering checks. The separate-database API suite tests both workflows through single-scan loading and billing, separate products/customers/mappings, cross-site cookie/connector rejection, foreign-carton rejection, remaining stock and blocked invoice posting. Seven connector journal/XML safeguards pass. TypeScript and .NET builds pass.

Physical scanners, printers, installed Tally versions and real voucher/stock readback remain for on-site acceptance.

## Release activation

Both company sites are deployed independently. Aromazon’s private database credentials and bootstrap settings were activated on 31 October 2026 after explicit user approval. Live checks confirmed database health, administrator login, saved-session restoration, fixed workflow rejection, cross-company cookie rejection, Aromazon save/read/restore persistence and management read-only enforcement. The temporary settings probe was restored, and Electro’s mapping was unchanged. No sample products, cartons, orders or trips were added to Aromazon.

Physical Tally, scanner and printer acceptance remains pending. Both current cloud databases are unclaimed trials: Electro expires on 2 November 2026 at 18:40 IST; Aromazon expires on 3 November 2026 at 10:44 IST. Claim each before its deadline and update runtime database credentials if the provider rotates them during transfer.

Public GitHub source export remains unapproved and unchanged. The company separation code is committed locally and deployed privately to the two user-owned Vercel projects.
