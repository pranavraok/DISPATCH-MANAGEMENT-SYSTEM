# Official references verified for this build

- .NET support: https://dotnet.microsoft.com/en-us/platform/support/policy/ and official .NET 10 release metadata. Selected LTS runtime 10.0.14 / SDK 10.0.403.
- EF/Npgsql 10: https://www.npgsql.org/efcore/release-notes/10.0.html and published NuGet packages. Selected Npgsql/EF provider 10.0.3, EF 10.0.14.
- PostgreSQL support: https://www.postgresql.org/support/versioning/. Compose pins 18.6; local executable validation used PostgreSQL 18.4, explicitly recorded.
- Vercel Container Runtime: https://vercel.com/docs/functions/runtimes/container. Explicit service entrypoint/routing was required for the existing project; a READY result with an empty output was rejected after endpoint verification and corrected.
- Tally integration prerequisites: https://help.tallysolutions.com/pre-requisites-for-integrations/.
- Tally sample XML: https://help.tallysolutions.com/sample-xml/ and https://help.tallysolutions.com/understanding-tally-xml-tags/.
- D-5015 manufacturer page: https://retsol.co.in/barcode-scanners/bluetooth-scanner/d5015/. No programming-barcode sequence or version-specific scanner setting was invented. Actual manual validation is pending.
- Claimable trial PostgreSQL: https://neon.com/docs/reference/claimable-neon and the currently functioning neon.new provisioning endpoint. This free unclaimed resource expires on 2 November 2026, 13:10 UTC. It is not permanent production storage.

Frontend packages were resolved against their actual published registry metadata and pinned in web/package.json/package-lock.json. The website includes no copied third-party marketing text or remote image assets. The exact unresolved integration boundaries are in VALIDATION.md.
