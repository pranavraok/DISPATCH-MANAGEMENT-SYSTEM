# AROMAZEN production connection release

This release updates only the AROMAZEN hosting project. It is based on repository commit `e73cb7e` in a separate worktree on `aromazen/production-connection`. It deliberately excludes the unshipped first-receipt-scan implementation and its migration. The revised QR/inventory workflow remains a subsequent local task, in the order requested by the user.

## Connection behavior

- Configure `DispatchSite=aromazon` and server-side `AromazenTallyCompany=AROMAZEN PRIVATE LIMITED` on the verified AROMAZEN Vercel project. Retain its own database and existing secrets.
- AROMAZEN can synchronize its own exact-company Tally stock items and debtor ledgers. Its accounting contract is `AromazenGSTInvoiceV1`.
- The authenticated `/api/connector/production-upgrade` endpoint accepts only the existing paired AROMAZEN connector, the deployment-owned exact company, and explicit production intent. It changes the server-side connector scope from Test to Production without changing the secret. It refuses revoked credentials, other companies, the Electro site, or an upgrade while invoice jobs are outstanding.
- The transition records an audit event and resets the accounting mapping to Unvalidated. It does not enable invoice creation or generate vouchers. A repeated verified upgrade is idempotent.
- After the hosted release is verified, `scripts/upgrade-aromazen-production.ps1` checks the exact local Tally company, decrypts the existing AROMAZEN key only in process memory, requests the server upgrade, backs up the old protected profile and updates the local scope only after successful acknowledgment. The key is not printed or passed on a command line.
- Stop the old AROMAZEN diagnostics process and start the AROMAZEN connector normally after both ends agree on Production. Verify heartbeat and master synchronization. Preserve Electro's processes and profile.

The actual ledger currently identified in Tally is named `Practice - Perfume Sales`. This is not evidence of an accountant-approved production invoice configuration. Complete ledger, state, HSN/GST, unit, stock, godown and charge mapping checks before invoice validation. No real invoice is authorized by this connection-only release.

## Validation performed locally

- ASP.NET API and connector builds pass with zero warnings or errors.
- Frontend production build passes; the existing bundle-size warning remains.
- Ten disposable PostgreSQL/API checks pass: credential authentication, exact-company and confirmation gates, preserved pairing key, mapping reset, idempotent audit, Production heartbeat, rejected old Test heartbeat, blocked invoice jobs until mapping validation, Electro isolation, revoked credentials, and outstanding-job refusal.
- The connector's nine offline safeguards cover explicit Test diagnostics and exclusion of master/invoice work in diagnostics mode, in addition to XML and journal checks.
- Production-upgrade PowerShell script passes syntax validation.

## Release conditions

Before deployment, verify the authenticated Vercel owner/team and existing project, preserve the current deployment identifier, and take a private database backup. Verify `DispatchSite` and database company identity against AROMAZEN. A fresh deployment is not evidence of a verified Tally connection: the server transition, local profile transition, heartbeat and master synchronization must all succeed before reporting the connection complete.

Access check on 4 November 2026: Vercel CLI authentication succeeded, but the authenticated account's accessible team did not contain the existing `aromazon-india-dispatch` project. Deployment inspection also could not resolve that domain in the authenticated context. No hosting environment values, database records, domains, or production deployments were changed. The required next step is authentication to the owning account/team or legitimate project access for the current account. The live connector has not been promoted; its verified pairing remains Test scope until the hosted API upgrade is deployed and acknowledged.
