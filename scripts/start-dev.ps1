$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:ConnectionStrings__Dispatch) { throw 'Set ConnectionStrings__Dispatch for your local PostgreSQL database first.' }
if (-not $env:BootstrapPassword) { throw 'Set BootstrapPassword to a unique 12+ character password first.' }
$env:MigrateOnStart = 'true'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5080'
dotnet run --project (Join-Path $repoRoot 'src\Dispatch.Api\Dispatch.Api.csproj')
