# Implementation stages

The complete specification is in MASTER_SPECIFICATION.txt. No Tally, scanner or printer access has been verified.

- [x] 1. PostgreSQL migration, secure sessions, role and company checks, audit/outbox.
- [x] 2. Packed drafts, approved unique cartons, strict import preview and request-idempotent commit. Automatic autosave and whole-file duplicate fingerprints remain pending.
- [x] 3. Genuine A4 QR PDF labels, attachment and content verification, revisions and holds. Actual physical printer/scanner checks pending.
- [x] 4. Partial allocations, multi-customer trips, atomic scan acceptance and unloading.
- [x] 5. Load approvals, decimal billing revisions and blocked unresolved mappings.
- [x] 6a. Separate Windows connector, scoped pairing, diagnostics and safe journal guard fixtures.
- [ ] 6b. Installation-specific posting/readback/reconciliation adapter, stock preflight and full lease/attempt pipeline.
- [x] 7a. Packing lists, confirmed-invoice/document departure gates, returns/quarantine and audit reports.
- [ ] 7b. Genuine invoice output, accountant-approved credit/restock and return redispatch.
- [x] 8a. Runnable container setup, Windows runbooks, automated tests, Vercel app/API deployment and GitHub source push.
- [ ] 8b. Vercel database credentials: automatic approval review requires explicit approval to transmit the new DB connection string and bootstrap passwords. Actual hardware/Tally and sustained-scale acceptance are also pending.

## Confirmed boundaries

Tally is accounting truth. PostgreSQL holds operational state. No stock deduction on scanning. Each carton has an immutable identity. Physical verification requires an operator. An uncertain external post cannot be retried automatically. Browser storage is used only for uncertain request envelopes, never operational inventory.

## External facts still pending

Installed Tally version, exact company identity, account and unit mappings, accountant-approved exported vouchers, validated duplicate marker/readback, tax/freight conventions, statutory gates, D-5015 HID settings and manual, actual A4 printer dimensions and physical end-to-end trial.
