param([Parameter(Mandatory=$true)][string]$Backup,[Parameter(Mandatory=$true)][string]$DisposableDatabase)
$ErrorActionPreference = 'Stop'
if ($DisposableDatabase -notmatch '^dispatch_restore_[a-z0-9_]+$') { throw 'Use a NEW disposable database named dispatch_restore_... Never restore over the live database.' }
createdb $DisposableDatabase
if ($LASTEXITCODE -ne 0) { throw 'Could not create a new disposable restore target.' }
pg_restore --no-owner --no-privileges --exit-on-error --dbname $DisposableDatabase $Backup
if ($LASTEXITCODE -ne 0) { throw 'Restore failed. Keep target for diagnosis.' }
psql --dbname $DisposableDatabase --command 'SELECT COUNT(*) FROM "Cartons"; SELECT COUNT(*) FROM "Audit";'
if ($LASTEXITCODE -ne 0) { throw 'Restore verification failed.' }
