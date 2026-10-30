param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
# Set PGHOST, PGPORT, PGUSER, PGDATABASE and PGPASSFILE securely in your environment.
pg_dump --format=custom --no-owner --file $Destination
if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
pg_restore --list $Destination | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Backup archive validation failed.' }
Get-FileHash -Algorithm SHA256 -LiteralPath $Destination
