[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$Database,
 [Parameter(Mandatory=$true)][string]$User,
 [string]$Server='127.0.0.1', [int]$Port=5432,
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [string]$PgBin='', [switch]$VerifyRestore
)
$ErrorActionPreference='Stop'
if($Database -notmatch '^[a-zA-Z][a-zA-Z0-9_]{0,62}$'){throw 'Use an ordinary PostgreSQL database name.'}
function PgTool([string]$name){if($PgBin){return Join-Path $PgBin "$name.exe"};return (Get-Command $name -ErrorAction Stop).Source}
$psql=PgTool 'psql';$dump=PgTool 'pg_dump'
$oldEnv=@{};foreach($key in @('PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD')){$oldEnv[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$restoreDatabase=$null;$createdVerificationDatabase=$false;$complete=$false
try {
 $env:PGHOST=$Server;$env:PGPORT=[string]$Port;$env:PGUSER=$User;$env:PGDATABASE=$Database
 if(-not $env:PGPASSWORD){$password=Read-Host 'PostgreSQL password (hidden; never stored in the backup script)' -AsSecureString;$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($password);try{$env:PGPASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}}
 $identity=& $psql -X -A -t -v ON_ERROR_STOP=1 -c 'SELECT CASE WHEN count(*)=1 AND max("Id")=''aromazon-india'' THEN ''AROMAZEN_ONLY'' ELSE ''STOP'' END FROM "Companies"'
 if($LASTEXITCODE -ne 0 -or ($identity -join '').Trim() -ne 'AROMAZEN_ONLY'){throw 'Backup stopped: this must be a database containing only the AROMAZEN company.'}
 $directory=[IO.Path]::GetFullPath($OutputDirectory);New-Item -ItemType Directory -Path $directory -Force|Out-Null
 $suffix=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
 $archive=Join-Path $directory "aromazen-$suffix.dump";$partial="$archive.partial"
 & $dump --format=custom --file=$partial
 if($LASTEXITCODE -ne 0){throw 'Database backup failed. The partial file was retained for diagnosis.'}
 $restore=PgTool 'pg_restore'; & $restore --list $partial | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Backup archive verification failed.'}
 if($VerifyRestore){
  $createdb=PgTool 'createdb';$dropdb=PgTool 'dropdb';$restoreDatabase='aromazen_restore_check_'+[guid]::NewGuid().ToString('N').Substring(0,12)
  & $createdb --maintenance-db=postgres $restoreDatabase
  if($LASTEXITCODE -ne 0){throw 'Could not create a new, disposable verification database. No existing database was restored over.'}
  $createdVerificationDatabase=$true
  & $restore --exit-on-error --no-owner --no-acl --dbname=$restoreDatabase $partial
  if($LASTEXITCODE -ne 0){throw 'Restore verification failed.'}
  $checks='SELECT json_build_object(''cartons'',(SELECT count(*) FROM "Cartons"),''orders'',(SELECT count(*) FROM "Orders"),''allocations'',(SELECT count(*) FROM "Allocations"),''bills'',(SELECT count(*) FROM "Billings"),''jobs'',(SELECT count(*) FROM "Jobs"),''audit'',(SELECT count(*) FROM "Audit"),''labels'',(SELECT count(*) FROM "AromazenQrLabels"),''presets'',(SELECT count(*) FROM "AromazenPackingPresets"),''productionBatches'',(SELECT count(*) FROM "AromazenProductionBatches"),''stockChecks'',(SELECT count(*) FROM "AromazenStockChecks"),''qrKeyDigest'',(SELECT md5(coalesce(string_agg("Secret",chr(124) ORDER BY "CompanyId"),chr(32))) FROM "AromazenQrKeys"))::text'
  $source=& $psql -X -A -t -v ON_ERROR_STOP=1 -c $checks;if($LASTEXITCODE -ne 0){throw 'Source verification query failed.'}
  $env:PGDATABASE=$restoreDatabase;$restored=& $psql -X -A -t -v ON_ERROR_STOP=1 -c $checks;if($LASTEXITCODE -ne 0){throw 'Restored verification query failed.'}
  if(($source -join '') -ne ($restored -join '')){throw 'The live source changed during verification, or restored counts/QR keys differ. Keep the backup and retry during a quiet period.'}
  Write-Output 'Restore verified: operational row counts and QR signing keys match.'
 }
 Move-Item -LiteralPath $partial -Destination $archive
 $complete=$true;Write-Output "AROMAZEN backup saved: $archive"
} finally {
 if($createdVerificationDatabase -and $restoreDatabase -match '^aromazen_restore_check_[0-9a-f]{12}$'){
  $env:PGDATABASE='postgres'; & $dropdb --maintenance-db=postgres $restoreDatabase
  if($LASTEXITCODE -ne 0){Write-Warning "Could not remove disposable verification database $restoreDatabase"}
 }
 foreach($key in $oldEnv.Keys){[Environment]::SetEnvironmentVariable($key,$oldEnv[$key],'Process')}
}
