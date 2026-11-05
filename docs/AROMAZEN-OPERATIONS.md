# AROMAZEN factory operations

## Everyday work

1. **Pack cartons:** enter the products and bottles in each carton, then the carton count. A saved packing mix can fill these details for you.
2. **Generate QR & add to inventory:** print the labels and attach them to the matching cartons. There is no receiving scan or browser approval.
3. **Dispatch:** choose the customer, scan each physical carton, then finish loading. Accounts checks the bill and creates the Tally invoice.

The 2D scanner is primary. Phone camera scanning in the web app is optional and needs HTTPS/camera permission. Wait for each saved confirmation. Starting a new order can open another tab; check the customer in the focused tab before scanning.

## Optional time savers

- **Saved packing mixes:** save products, quantities and carton groups for reuse. A saved mix does not add stock. Manufacturing batch references are deliberately cleared whenever it is reused.
- **Manufacturing batch references:** optional per-product references in the packing form. They are separate from the packing-list name and Tally batch/godown fields. They are not added to the QR or printed label text. Inventory's batch search follows current carton revisions, customer/order allocations, confirmed invoice references and returns. Blank historical batches cannot be inferred or backfilled automatically.
- **Help me choose cartons:** enter requested product quantities inside the selected dispatch. Suggestions prefer suitable mixed cartons, then older packed cartons. They exclude held, unlabelled, unavailable, wrong-warehouse and other-customer cartons. They never reserve stock, include unwanted products or exceed a requested quantity. This is a bounded heuristic, not a guarantee of the best combination; a partial result can have other possible combinations. Each suggested carton must still be found and scanned. Search is capped at 5,000 candidate cartons and reports when more exist.
- **Check physical stock:** starts a snapshot of ready carton identities. Scan to count, not dispatch. Duplicate scans do not add counts. Missing and unexpected cartons are reported; dispatch activity since the start is flagged. It checks carton presence, not the contents of bottles inside. No automatic inventory or accounting adjustments occur. Download all differences for the complete report; the screen previews the first 50 in each category. Keep physical counts to a quiet period where possible.

## Correct mistakes without deleting history

- Inventory **Check / correct carton** can put a doubtful or damaged carton on hold. It cannot be dispatched while held.
- A packing supervisor can correct products, quantities and manufacturing batches of an available/unallocated carton. This retires the old label revision. Generate and attach the replacement QR before the carton becomes available again. Correcting a held carton does not clear its hold.
- Dispatch **Unload & return carton to inventory** is for a carton physically removed before loading approval.
- **Correct a loading mistake** reopens a load only before an invoice is in progress or confirmed. The load and bill must be checked again. It does not remove an invoice in Tally.
- Past Orders **Order actions → Cancel order** requires a reason and exact order reference. AROMAZEN blocks cancellation while cartons are still loaded or the load/invoice is approved or in progress. Physically unload first; use controlled correction/accountant reconciliation for later stages. Orders and audit history remain.
- **Returns** uses the original departed shipment and carton. Returned quantities cannot exceed the original unreturned sale. Goods remain separate in quarantine/disposal/accounting-review states. They do not automatically become available cartons or create a credit note. Accounts must reconcile Tally and the physical goods before any restock.

## Backup and readiness

`scripts/backup-aromazen.ps1` creates a PostgreSQL custom-format backup only after checking that the database contains only AROMAZEN. It includes QR signing keys, label mappings, presets, manufacture-batch records and stock checks. Passwords are supplied through the process environment or a hidden prompt, not command arguments. `-VerifyRestore` creates a newly named disposable database, restores the archive, compares operational row counts and the QR-key digest, then removes only that newly created verification database. Existing databases are never overwritten. Use an account with the required permissions. Verification should run while writes are quiet; concurrent changes can make comparison fail even for a valid snapshot. Secure and retain backups outside the repository and set up the deployment owner's managed/scheduled backup policy before go-live.

Example (fill the correct AROMAZEN database/user; use PostgreSQL client tools of a compatible version):

```powershell
& .\scripts\backup-aromazen.ps1 -Database YOUR_AROMAZEN_DB -User YOUR_DB_USER -Server YOUR_DB_HOST -Port 5432 -OutputDirectory C:\AROMAZEN-Backups -VerifyRestore
```

Local acceptance verified logical workflows, simulated Tally readback and a real local backup/restore. Go-live still needs a real printed-label/2D-scanner check, a real phone over HTTPS, accountant-approved company/ledger/GST/unit/customer mappings, controlled real Tally invoice acceptance and the hosting owner's production backup configuration. Those checks cannot be established by browser simulation or deployment alone. Weight verification is outside scope.
