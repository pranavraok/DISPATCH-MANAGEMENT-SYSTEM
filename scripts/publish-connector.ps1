param([string]$Destination = (Join-Path $PSScriptRoot '..\artifacts\connector'))
$ErrorActionPreference = 'Stop'
dotnet publish (Join-Path $PSScriptRoot '..\src\Dispatch.Connector\Dispatch.Connector.csproj') -c Release -r win-x64 --self-contained true -o $Destination
if ($LASTEXITCODE -ne 0) { throw 'Connector publish failed.' }
Write-Host "Published to $Destination. Run Dispatch.Connector.exe --pair as the user who will run the connector."
