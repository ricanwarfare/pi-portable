[CmdletBinding()]
param([switch]$RequireStandardUser)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Output "Running tests with administrator token: $elevated"
if ($RequireStandardUser -and $elevated) { throw 'Run these tests from a non-elevated terminal.' }
Push-Location $root
try {
    $tests = Get-ChildItem tests -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
    & node --test @tests
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
} finally { Pop-Location }
