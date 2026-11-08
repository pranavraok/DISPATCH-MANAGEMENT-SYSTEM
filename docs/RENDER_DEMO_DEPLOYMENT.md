# Render demo deployment

This Blueprint deploys the existing `Dockerfile.vercel` image as two separate Render Docker web services, one for Electro and one for Aromazen. It keeps the current React frontend, ASP.NET API, workflows, connector behavior, company isolation, and existing PostgreSQL databases. It does not add a Render database or run EF migrations. Vercel is left untouched.

## Before creating services

- The repository must be pushed to GitHub and connected to Render.
- Use Render's Free web service plan for both services in the Blueprint. Free web services can sleep after 15 minutes without inbound traffic; allow about a minute for the first request after a sleep.
- Copy each existing database connection URL privately from its current provider. Do not add it to this repository, GitHub, or chat.
- Confirm the current database provider accepts connections from Render. Render Free services use public outbound connectivity; providers with IP allowlists may need an allowlist change.

## Deploy both demo services

1. In Render, choose **New → Blueprint** and connect `pranavraok/DISPATCH-MANAGEMENT-SYSTEM`.
2. Select the branch containing `render.yaml` and review the two Free services in Singapore.
3. When prompted, enter Electro's existing PostgreSQL URL for `electro-group-dispatch-demo` and Aromazen's existing PostgreSQL URL for `aromazen-india-dispatch-demo`. These populate the `DATABASE_URL` secret for each service separately.
4. Create the Blueprint and wait until both services deploy and pass `/api/health`.
5. Open each generated `onrender.com` URL. Confirm `/api/site` reports the expected company slug and `/api/health` reports `database: Connected`.
6. For an Electro Tally demo, pair the connector to the Electro Render URL. Start the connector shortly before the demo and stop it afterward so its two-minute heartbeat does not keep the free service awake between demonstrations.

The Blueprint uses the existing production container and sets ASP.NET to listen on Render's web-service port. The code path is unchanged.

## Important free-plan behavior

Render provides 750 free instance hours per workspace per calendar month, shared by its Free web services. A running Tally connector sends a heartbeat every 15–120 seconds and therefore prevents the Electro service from idling. Two continuously active company services exceed the shared monthly allowance. Keep the connector stopped between demos and avoid leaving both sites continuously active.

Render's 30-day expiration applies to Render Free Postgres only. This Blueprint deliberately keeps the existing company databases where they are. Check those providers' own retention and availability rules separately.

If a database provider restricts inbound connections, allow Render's Singapore outbound IP ranges only if that provider supports and requires IP allowlisting. Do not weaken database access controls broadly.

## Acceptance and rollback

Vercel is not disabled by this deployment. Before changing the URLs given to a client, verify both company slugs, database connectivity, login, saved demo records, refresh persistence, and any required Tally interaction. A successful health check does not prove that an invoice was posted to the intended Tally company; verify the voucher in Tally. Keep the current Vercel URLs available for rollback.
