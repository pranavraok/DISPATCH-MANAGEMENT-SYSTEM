# Implementation stages

The complete specification is in MASTER_SPECIFICATION.txt. No Tally, scanner or printer access has been verified.

- [ ] 1. PostgreSQL migration, secure sessions, role and company checks, audit/outbox.
- [ ] 2. Packed drafts, approved unique cartons, strict import preview and idempotent commit.
- [ ] 3. Genuine A4 QR PDF labels, attachment and content verification, revisions and holds.
- [ ] 4. Partial allocations, multi-customer trips, atomic scan acceptance and unloading.
- [ ] 5. Load approvals, decimal billing revisions and blocked unresolved mappings.
- [ ] 6. Separate Windows connector, scoped pairing, diagnostics, safe journal and reconciliation boundaries.
- [ ] 7. Documents, departure gates, returns/quarantine and reports.
- [ ] 8. Runnable container setup, Windows runbooks, automated tests, deployment.

## Confirmed boundaries

Tally is accounting truth. PostgreSQL holds operational state. No stock deduction on scanning. Each carton has an immutable identity. Physical verification requires an operator. An uncertain external post cannot be retried automatically. Browser storage is used only for uncertain request envelopes, never operational inventory.

## External facts still pending

Installed Tally version, exact company identity, account and unit mappings, accountant-approved exported vouchers, validated duplicate marker/readback, tax/freight conventions, statutory gates, D-5015 HID settings and manual, actual A4 printer dimensions and physical end-to-end trial.
