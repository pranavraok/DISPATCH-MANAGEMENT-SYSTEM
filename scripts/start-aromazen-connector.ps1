$ErrorActionPreference = 'Stop'
$configPath = Join-Path $env:LOCALAPPDATA 'DispatchCompanies/aromazon/DispatchConnector/config.json'
if (!(Test-Path -LiteralPath $configPath)) { throw 'Pair the AROMAZEN connector first.' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$connectorPath = @(
    (Join-Path $PSScriptRoot 'Dispatch.Connector.exe'),
    (Join-Path $PSScriptRoot '../artifacts/aromazen-connector/Dispatch.Connector.exe'),
    (Join-Path $PSScriptRoot '../artifacts/connector/Dispatch.Connector.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$connectorPath) { throw 'Publish the Windows connector with scripts/publish-connector.ps1 before starting it.' }
if ($config.Environment -eq 'Test') {
    Write-Host 'AROMAZEN Test diagnostics only. Master sync and invoices are disabled.' -ForegroundColor Yellow
    & $connectorPath --profile aromazon --diagnostics-only
} elseif ($config.Environment -eq 'Production') {
    & $connectorPath --profile aromazon
} else { throw 'Unsupported AROMAZEN environment. No connector was started.' }
