# AROMAZEN: QR-generated packed inventory and dispatch

Revised locally on 4 November 2026 for the approved checklist. This source revision is prepared for publication on its own branch following local user review. Source publication does not deploy the app. The separate production-connection branch was published earlier. Electro's workflow and live data remain outside this change.

## Completed checklist

- [x] Keep this revision local and AROMAZEN-only.
- [x] Begin carton entry with one product. Add more products to the same carton group and add another group for a different mix, following the existing Electro entry style. Quantities are per carton; 20 bottles is an example. There is no fixed two-product restriction.
- [x] Save carton plans as `PendingLabel`, outside available inventory. Generating QR labels atomically changes those cartons to Available and adds their recorded product quantities to packed inventory.
- [x] Remove the first inventory scan and supervisor receiving approval. The retired receipt command returns 410; AROMAZEN's obsolete attachment/approval command is rejected without changing inventory.
- [x] Print/reprint using the original carton ID and revision. Reprinting and request retries do not add stock again. QR generation persists before PDF download; a printer/PDF failure can be recovered by printing the same identities again.
- [x] Show available carton counts, product quantities, pending QR plans and held cartons. Product balances are computed in PostgreSQL across all available, unheld AROMAZEN cartons, independently of the displayed carton page. Mixed cartons contribute to each product row but are counted once as physical cartons. Contents lookup remains read-only.
- [x] Select the customer/reference/destination before dispatch. One accepted scan atomically claims the whole available carton, removes its products from available inventory and updates that customer's draft bill. Duplicate or competing-customer scans do not double-count.
- [x] Keep the existing loading approval, price review, billing approval, Tally submission and verified invoice readback path. Missing Tally prices require explicit saved prices before bill approval. The local preview has no live Tally connector and cannot create real vouchers.
- [x] Preserve existing carton IDs, revisions, label snapshots and audit history. The migration recognizes QR labels already generated at the current revision and retains verified legacy availability, while unlabelled plans remain PendingLabel. Reserved/loaded records and Electro rows are unchanged.
- [x] Update API checks, UI tests, migration checks, browser acceptance and operator notes.

## Operator sequence

1. Open **Pack & QR labels**. Enter a packing batch, the carton marking and number of identical cartons. Enter one product and quantity per carton; use **Add another product to these cartons** as needed. Use another carton group for a different mix.
2. **Save carton contents**. This records the carton plan but does not increase available stock.
3. **Generate QR & add to inventory**. The system creates the label job, makes the cartons available and downloads the A4 QR-label PDF. Print and attach each label to its matching physical carton. No first scan or receiving approval follows.
4. Review **Inventory**. Both carton counts and product quantities reflect generated QR labels. Reprint selected identities if a label is damaged or printing fails. The content lookup does not move stock.
5. Open **Dispatch**, select the customer and enter the order/reference and destination. Start scanning each complete carton as it is loaded. Its full product mix is accumulated into the same bill. Unscanned stock stays available.
6. If a carton is physically removed before loading approval, use **Unload & return carton to inventory** and enter a reason. Its products return to available stock and are removed from the current bill.
7. Finish loading, review/edit the bill and approve. On a properly configured production deployment, the separate AROMAZEN Tally connector creates and verifies the invoice. A scan alone does not update Tally's booked stock.

## Corrections and limits

Revising an unused carton's contents invalidates the old QR revision and moves it out of available stock until the new QR is generated. Repacking retires the old identity; replacement cartons enter inventory when their own QR labels are generated. Draft/unused deletion retains an audit record; dispatched history is protected.

The existing bounds remain: at most 100 content lines per carton, 1,000 cartons per generated label batch, positive quantities with six decimal places, and exact SKU/unit validation. A4 labels reject overflowing content rather than silently omitting products. Product rows use base quantities where a validated conversion exists.

## Local review

The running preview is **http://localhost:5173/**. It uses a separate local PostgreSQL database and clearly named preview products/customers. The login is `preview@aromazen.local`, with the local-demo password `AromazenPreview!2026`. These are local preview credentials, not hosted-company credentials. A local-review banner is enabled only in Development configuration.

The preview includes example cartons and customer dispatches created by browser acceptance checks. It does not read the live company database, change the protected Windows Tally pairing, or send real invoice requests. Developer startup and preview-process metadata are under ignored `.local/`.

## Verification

- API Release and TypeScript/Vite builds pass. The existing frontend bundle-size warning remains.
- **22** disposable PostgreSQL/API workflow checks pass, covering QR inventory creation, reprint neutrality, one and three product mixes, held/unlabelled rejection, read-only lookup, full-inventory totals beyond pagination, dispatch/billing, unload/revision, missing prices, concurrent duplicates and competing customers, invoice job gates and Electro isolation.
- **9** AROMAZEN screen tests pass for flexible carton groups, explicit QR generation, reprinting, removed receipt controls, whole-inventory balances, read-only lookup, management restrictions and customer selection.
- **6** database migration checks pass for existing generated labels, unlabelled plans, verified legacy inventory, reserved/loaded records, unchanged Electro records and preserved IDs/revisions/labels/audit.
- The untouched source had **15** frontend failures. The current full suite retains those same failures and adds no new failures; the AROMAZEN-specific tests pass.
- Headless Chrome acceptance passed through login, multi-product entry, actual QR PDF download, inventory updates, reprinting, customer dispatch, duplicate protection, bill totals, loading-to-billing navigation and a 390-pixel mobile layout without page-wide overflow.
- Invoice readback in automated tests was explicitly simulated. Actual Tally voucher creation and physical paper/scanner acceptance are separate from this local code review.

## Later deployment

The deployment owner must target only the existing AROMAZEN project and database; see DEPLOY-AROMAZEN-REVISED-WORKFLOW.md. Keep `DispatchSite=aromazon` and its exact server-side Tally company mapping. Preserve Electro's deployment and configuration. Review migrations and back up AROMAZEN's data before deployment. Production connection work remains separately documented in the production-connection worktree.
