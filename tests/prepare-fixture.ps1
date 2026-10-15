$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root '.build/fixture'
New-Item -ItemType Directory -Force $dir | Out-Null
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:exe /platform:x64 "/out:$dir\pi.exe" (Join-Path $PSScriptRoot 'Fixture.cs')
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
# A unique archive avoids deleting previous test artifacts.
$zipPath = Join-Path $root ('.build/fixture-' + [Guid]::NewGuid().ToString('N') + '.zip')
[IO.Compression.ZipFile]::CreateFromDirectory($dir, $zipPath)
& "$root/scripts/build.ps1" -PayloadZip $zipPath -ExpectedSha256 (Get-FileHash $zipPath -Algorithm SHA256).Hash -OutputPath "$root/.build/fixture-launcher.exe"
$badZip = "$zipPath.bad.zip"
$archive = [IO.Compression.ZipFile]::Open($badZip, [IO.Compression.ZipArchiveMode]::Create)
try { $null = $archive.CreateEntry('../escaped.txt') } finally { $archive.Dispose() }
& "$root/scripts/build.ps1" -PayloadZip $badZip -ExpectedSha256 (Get-FileHash $badZip -Algorithm SHA256).Hash -OutputPath "$root/.build/unsafe-launcher.exe"
