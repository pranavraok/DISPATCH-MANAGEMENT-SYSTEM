# Deploy the revised AROMAZEN QR inventory workflow

This branch includes QR-generated packed inventory, flexible product/carton groups, customer-first dispatch scanning, billing and the AROMAZEN production-connection API. It supersedes the earlier local two-scan design.

## Deployment owner

1. Use only the existing Vercel project serving `https://aromazon-india-dispatch.vercel.app/`. Preserve Electro's project, environment and database.
2. Back up AROMAZEN's current database privately and retain the current deployment identifier for rollback. Preserve its existing database connection and bootstrap secrets.
3. Verify Production runtime configuration: `DispatchSite=aromazon` and `AromazenTallyCompany=AROMAZEN PRIVATE LIMITED`. Preview environments require their own appropriate configuration. Do not enable `LocalPreview` in the hosted deployment.
4. Deploy this branch with the existing container/.NET configuration. Review and apply pending EF migrations. The QR inventory migration preserves identities and history, recognizes labels already generated at their current revision, keeps verified legacy stock available, and leaves reserved/loaded records and Electro rows unchanged.
5. Verify `/api/site` identifies `aromazon` and `aromazon-india`, and `/api/health` reports the AROMAZEN API and connected database. Normal sign-in should show **Pack & QR labels**, **Inventory**, **Dispatch** and **Billing**.
6. Verify a small approved carton plan: save contents, generate QR labels, confirm carton/product inventory totals, and reprint the same identities without increasing quantities. Select a customer before the only operational scan, during dispatch. Do not use local preview/sample credentials as hosted-company credentials.

## Tally connection

The existing Test pairing must not simply be relabelled in a local config file. On the paired Windows user account, `scripts/upgrade-aromazen-production.ps1` checks the exact local Tally company and requests the server-verified transition using the existing Windows-protected key. It backs up the Test profile and updates the local environment only after server acknowledgment. Then `scripts/start-aromazen-connector.ps1` locates and starts the AROMAZEN executable. Test profiles remain diagnostics-only.

Production pairing/heartbeat does not itself approve accounting mappings. Confirm AROMAZEN's actual products, customers, Sales/GST ledgers, tax classifications, units, stock, godown and charges before validating invoice posting. The observed `Practice - Perfume Sales` ledger has not been confirmed for real invoices. No test invoice is created by deployment or connection upgrade.

## Verification already performed

API and frontend builds passed. The revision passed 22 isolated API checks, nine AROMAZEN screen tests, six migration-preservation checks and headless Chrome acceptance covering actual QR PDF download, reprints, inventory, dispatch, duplicate protection, bill totals and desktop/mobile layouts. The full frontend suite retains the same 15 pre-existing failures as the untouched source, with no new failures. Automated Tally readback was simulated; physical scanner/printing and real accounting acceptance remain separate.

Source publication does not deploy either company. Local development credentials, protected connector keys, private environment files, database dumps and preview runtime files are excluded from this release.
