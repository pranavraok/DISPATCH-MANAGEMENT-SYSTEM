$ErrorActionPreference = 'Stop'
$company = 'AROMAZEN PRIVATE LIMITED'
$cloud = 'https://aromazon-india-dispatch.vercel.app/'
$profilePath = Join-Path $env:LOCALAPPDATA 'DispatchCompanies/aromazon/DispatchConnector'
$configPath = Join-Path $profilePath 'config.json'
$credentialPath = Join-Path $profilePath 'credential.dpapi'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.Cloud.TrimEnd('/') -cne $cloud.TrimEnd('/') -or $config.Company -cne $company -or $config.Environment -notin @('Test','Production')) { throw 'The saved profile is not the expected AROMAZEN pairing. No upgrade attempted.' }
$site = Invoke-RestMethod -Uri ($cloud + 'api/site') -TimeoutSec 20
if ($site.slug -ne 'aromazon' -or $site.companyId -ne 'aromazon-india') { throw 'Wrong portal company. No upgrade attempted.' }
$probe = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AromazenUpgradeCheck</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>AROMAZEN PRIVATE LIMITED</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="AromazenUpgradeCheck"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
$reply = Invoke-WebRequest -UseBasicParsing -Uri $config.TallyEndpoint -Method Post -ContentType 'text/xml' -Body $probe -TimeoutSec 10
$settings = [System.Xml.XmlReaderSettings]::new(); $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit; $settings.XmlResolver = $null
$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new([string]$reply.Content), $settings)
try { $document = [System.Xml.XmlDocument]::new(); $document.XmlResolver=$null; $document.Load($reader) } finally { $reader.Dispose() }
$names = @($document.SelectNodes('//COMPANY') | ForEach-Object { $_.GetAttribute('NAME') })
if ($names -cnotcontains $company) { throw 'The exact AROMAZEN company is not available in Tally. No upgrade attempted.' }
Add-Type -AssemblyName System.Security
$secretBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credentialPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
    $headers = @{ 'X-Connector-Id'=$config.ConnectorId; 'X-Connector-Key'=[Text.Encoding]::UTF8.GetString($secretBytes) }
    $result = Invoke-RestMethod -Uri ($cloud + 'api/connector/production-upgrade') -Method Post -ContentType 'application/json' -Headers $headers -Body (@{company=$company;confirmProduction=$true}|ConvertTo-Json) -TimeoutSec 20
    if ($result.environment -cne 'Production' -or $result.expectedCompany -cne $company) { throw 'The portal did not verify the exact production company. Local profile unchanged.' }
    if ($config.Environment -eq 'Test') {
        $backup = Join-Path $profilePath ('test-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $backup | Out-Null
        Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'config.json')
        Copy-Item -LiteralPath $credentialPath -Destination (Join-Path $backup 'credential.dpapi')
        $config.Environment = 'Production'
        $temporaryConfig = Join-Path $profilePath 'production-config.pending.json'
        [IO.File]::WriteAllText($temporaryConfig, ($config|ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        [IO.File]::Copy($temporaryConfig,$configPath,$true)
        Remove-Item -LiteralPath $temporaryConfig
    }
    Write-Output 'AROMAZEN server and local profile now agree on Production. No invoice was created; accounting mapping remains a separate verification.'
} finally {
    [Array]::Clear($secretBytes,0,$secretBytes.Length)
    $headers = $null
}
