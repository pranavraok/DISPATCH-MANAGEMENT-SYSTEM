$ErrorActionPreference = 'Stop'
$statusPath = Join-Path $PSScriptRoot 'aromazen-pairing-status.json'
$cloud = 'https://aromazon-india-dispatch.vercel.app/'
$company = 'AROMAZEN PRIVATE LIMITED'
$endpoint = 'http://127.0.0.1:9000'
$profileDirectory = Join-Path $env:LOCALAPPDATA 'DispatchCompanies/aromazon/DispatchConnector'
function Save-Status($state, $message) {
    @{ state = $state; message = $message; time = [DateTimeOffset]::Now.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
}
Save-Status 'AwaitingCredentials' 'Waiting for the AROMAZEN Connector ID and hidden pairing key in the local PowerShell window.'
try {
    Write-Host 'AROMAZEN connection setup' -ForegroundColor Cyan
    Write-Host "Portal: $cloud"
    Write-Host "Exact Tally company: $company"
    Write-Host 'Use credentials from AROMAZEN Settings, not Electro.'
    Write-Host ''
    if (Test-Path -LiteralPath (Join-Path $profileDirectory 'config.json')) { throw 'An AROMAZEN pairing already exists. It was left untouched.' }
    $connectorId = (Read-Host 'Paste AROMAZEN Connector ID, then press Enter').Trim()
    if ($connectorId -notmatch '^[0-9a-fA-F]{32}$') { throw 'Connector ID must be the 32-character ID from AROMAZEN Settings.' }
    $secureKey = Read-Host 'Paste the pairing key here, then press Enter (hidden)' -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try { $pairingKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
    if ($pairingKey -notmatch '^[0-9a-fA-F]{64}$') { throw 'The pairing key must be the complete 64-character key from that same connection.' }
    $site = Invoke-RestMethod -Uri ($cloud + 'api/site') -TimeoutSec 20
    if ($site.slug -ne 'aromazon' -or $site.companyId -ne 'aromazon-india') { throw 'The portal company did not match AROMAZEN. No pairing was saved.' }
    $companyProbe = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AromazenPairingCheck</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="AromazenPairingCheck"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>'
    $reply = Invoke-WebRequest -UseBasicParsing -Uri $endpoint -Method Post -ContentType 'text/xml' -Body $companyProbe -TimeoutSec 10
    $xmlSettings = New-Object System.Xml.XmlReaderSettings
    $xmlSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $xmlSettings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new([string]$reply.Content), $xmlSettings)
    try { $document = New-Object System.Xml.XmlDocument; $document.XmlResolver = $null; $document.Load($reader) } finally { $reader.Dispose() }
    $names = @($document.SelectNodes('//COMPANY') | ForEach-Object { $_.GetAttribute('NAME') })
    if ($names -cnotcontains $company) { throw 'AROMAZEN PRIVATE LIMITED is not loaded in the local Tally instance. No pairing was saved.' }
    $headers = @{ 'X-Connector-Id' = $connectorId; 'X-Connector-Key' = $pairingKey }
    $body = @{ company = $company; environment = 'Production'; tallyReachable = $true; version = '1.8.0-company-dispatch'; detail = 'Local AROMAZEN company verified during pairing. No voucher operation performed.' } | ConvertTo-Json
    $connectionEnvironment = 'Production'
    try {
        try { $verified = Invoke-RestMethod -Uri ($cloud + 'api/connector/heartbeat') -Method Post -ContentType 'application/json' -Headers $headers -Body $body -TimeoutSec 20 }
        catch {
            if (!$_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 409) { throw }
            Write-Host 'Production scope was not accepted. Checking the same exact company in Test diagnostics scope.' -ForegroundColor Yellow
            $connectionEnvironment = 'Test'
            $body = @{ company = $company; environment = 'Test'; tallyReachable = $true; version = '1.8.0-company-dispatch'; detail = 'AROMAZEN Test diagnostics only. Exact local company verified; master sync and invoice processing disabled.' } | ConvertTo-Json
            $verified = Invoke-RestMethod -Uri ($cloud + 'api/connector/heartbeat') -Method Post -ContentType 'application/json' -Headers $headers -Body $body -TimeoutSec 20
        }
    }
    catch {
        $httpCode = 0
        if ($_.Exception.Response) { $httpCode = [int]$_.Exception.Response.StatusCode }
        $serverError = ''
        $errorBody = $_.ErrorDetails.Message
        if (!$errorBody -and $_.Exception.Response) {
            try { $errorReader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); try { $errorBody = $errorReader.ReadToEnd() } finally { $errorReader.Dispose() } } catch {}
        }
        if ($errorBody) { try { $serverError = [string](ConvertFrom-Json $errorBody).error } catch {} }
        if ($serverError) { $serverError = $serverError.Replace($pairingKey, '[hidden]').Replace($connectorId, '[connector ID]') }
        $explanation = switch ($httpCode) {
            401 { 'The portal did not accept this connector credential (unknown/revoked ID or a mismatched key).' }
            409 { 'The portal connector record has a different expected company or environment. Editing general Tally settings does not update an already-created connector record.' }
            403 { 'The portal refused access for this connection.' }
            429 { 'The portal rate limit was reached. Wait briefly before retrying.' }
            0 { 'The verification request did not receive an HTTP response. Check the network connection.' }
            default { 'The portal returned an unsuccessful response.' }
        }
        if ($serverError) { throw "Pairing verification failed (HTTP $httpCode): $serverError $explanation No pairing was saved." }
        throw "Pairing verification failed (HTTP $httpCode). $explanation No pairing was saved."
    }
    if ($verified.expectedCompany -cne $company) { throw 'The portal returned a different expected company. No pairing was saved.' }
    Add-Type -AssemblyName System.Security
    $keyBytes = [Text.Encoding]::UTF8.GetBytes($pairingKey)
    try { $protectedKey = [Security.Cryptography.ProtectedData]::Protect($keyBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
    finally { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
    New-Item -ItemType Directory -Force -Path $profileDirectory | Out-Null
    @{ Cloud = $cloud; ConnectorId = $connectorId; Company = $company; Environment = $connectionEnvironment; TallyEndpoint = $endpoint } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $profileDirectory 'config.json') -Encoding UTF8
    [IO.File]::WriteAllBytes((Join-Path $profileDirectory 'credential.dpapi'), $protectedKey)
    Save-Status 'Paired' "AROMAZEN credentials verified in $connectionEnvironment scope, local Tally company checked, and the separate Windows-protected pairing saved. No voucher was created."
    if ($connectionEnvironment -eq 'Test') { Write-Host 'The hosted connection uses Test scope. It must be started in diagnostics-only mode. Invoicing is not enabled.' -ForegroundColor Yellow }
    Write-Host 'AROMAZEN paired successfully. Return to Codex so the connector can be started.' -ForegroundColor Green
} catch {
    Save-Status 'NeedsAttention' $_.Exception.Message
    Write-Host $_.Exception.Message -ForegroundColor Yellow
} finally {
    $pairingKey = $null; $headers = $null
    if ($secureKey) { $secureKey.Dispose() }
}
