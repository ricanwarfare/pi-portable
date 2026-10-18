[CmdletBinding()]
param(
    [string]$PayloadZip,
    [string]$ExpectedSha256,
    [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$buildDir = Join-Path $root '.build'
New-Item -ItemType Directory -Force $buildDir | Out-Null
$release = Get-Content (Join-Path $root 'upstream-release.json') -Raw | ConvertFrom-Json
if ($release.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Upstream version must be major.minor.patch.' }
$version = (Get-Content (Join-Path $root 'version.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'version.json must contain a major.minor.patch version.' }
$official = -not $PayloadZip
if (-not $PayloadZip) {
    $PayloadZip = Join-Path $buildDir "pi-$($release.version)-windows-x64.zip"
    if (-not (Test-Path -LiteralPath $PayloadZip)) {
        Invoke-WebRequest $release.url -OutFile $PayloadZip
    }
    $ExpectedSha256 = $release.sha256
}
if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'A pinned SHA256 is required for the payload.' }
$PayloadZip = (Resolve-Path -LiteralPath $PayloadZip).Path
if ((Get-FileHash -LiteralPath $PayloadZip -Algorithm SHA256).Hash -ne $ExpectedSha256) {
    throw 'Payload SHA256 mismatch. Refusing to build.'
}
if ($official) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $combined = Join-Path $buildDir 'payload.zip'
    Copy-Item -LiteralPath $PayloadZip -Destination $combined -Force
    $archive = [IO.Compression.ZipFile]::Open($combined, [IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($tool in $release.tools) {
            $toolZip = Join-Path $buildDir "$($tool.name).zip"
            if (-not (Test-Path -LiteralPath $toolZip)) { Invoke-WebRequest $tool.url -OutFile $toolZip }
            if ((Get-FileHash -LiteralPath $toolZip -Algorithm SHA256).Hash -ne $tool.sha256) { throw "$($tool.name) SHA256 mismatch." }
            $source = [IO.Compression.ZipFile]::OpenRead($toolZip)
            try {
                foreach ($entry in $source.Entries) {
                    if (-not $entry.Name) { continue }
                    # Retain all upstream docs and license files, without the archive's wrapper directory.
                    $relative = $entry.FullName.Substring($entry.FullName.IndexOf('/') + 1)
                    $target = $archive.CreateEntry("tools/$($tool.name)/$relative")
                    $target.LastWriteTime = $entry.LastWriteTime
                    $inputStream = $entry.Open()
                    $outputStream = $target.Open()
                    try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
                }
            } finally { $source.Dispose() }
        }
        foreach ($name in @('policy.ts', 'network.mjs', 'web-network.mjs', 'web.ts', 'subagents.ts', 'settings.ts')) {
            $target = $archive.CreateEntry("portable/$name")
            $inputStream = [IO.File]::OpenRead((Join-Path $root "src/$name"))
            $outputStream = $target.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
        }
        $webRelease = Get-Content (Join-Path $root 'web-access-release.json') -Raw | ConvertFrom-Json
        foreach ($entry in $webRelease.files.PSObject.Properties) {
            if ($entry.Name.Contains('..') -or $entry.Name.Contains(':') -or $entry.Name.StartsWith('/') -or $entry.Name.Contains('\')) { throw 'Unsafe web package path.' }
            $file = Join-Path $root "vendor/pi-agent-web-access/$($entry.Name)"
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.Value) { throw "Web extension checksum mismatch: $($entry.Name)" }
            $target = $archive.CreateEntry("vendor/pi-agent-web-access/$($entry.Name)")
            $inputStream = [IO.File]::OpenRead($file); $outputStream = $target.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
        }
        $subagentsRelease = Get-Content (Join-Path $root 'subagents-release.json') -Raw | ConvertFrom-Json
        foreach ($entry in $subagentsRelease.files.PSObject.Properties) {
            if ($entry.Name.Contains('..') -or $entry.Name.Contains(':') -or $entry.Name.StartsWith('/') -or $entry.Name.Contains('\')) { throw 'Unsafe subagents package path.' }
            $file = Join-Path $root "vendor/pi-subagents/$($entry.Name)"
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.Value) { throw "Subagents checksum mismatch: $($entry.Name)" }
            $target = $archive.CreateEntry("vendor/pi-subagents/$($entry.Name)")
            $inputStream = [IO.File]::OpenRead($file); $outputStream = $target.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
        }
    } finally { $archive.Dispose() }
    $PayloadZip = $combined
    $ExpectedSha256 = (Get-FileHash -LiteralPath $PayloadZip -Algorithm SHA256).Hash
}
if (-not $OutputPath) { $OutputPath = Join-Path $root 'dist/pi-portable.exe' }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force (Split-Path $OutputPath -Parent) | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required on the build system.' }
$buildInfo = Join-Path $buildDir 'BuildInfo.cs'
$metadata = @(
    '[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]',
    ('[assembly: System.Reflection.AssemblyVersion("' + $version + '.0")]'),
    ('[assembly: System.Reflection.AssemblyFileVersion("' + $version + '.0")]'),
    '[assembly: System.Reflection.AssemblyProduct("Pi Portable")]',
    '[assembly: System.Reflection.AssemblyDescription("Portable Pi coding agent for internal endpoints")]',
    ('internal static class BuildInfo { internal const string Version = "' + $version + '"; internal const string UpstreamVersion = "' + $release.version + '"; internal const string PayloadHash = "' + $ExpectedSha256.ToLowerInvariant() + '"; }')
)
[IO.File]::WriteAllLines($buildInfo, $metadata)
& $compiler /nologo /optimize+ /target:exe /platform:x64 "/out:$OutputPath" "/win32manifest:$root/src/app.manifest" "/win32icon:$root/assets/pi-portable.ico" /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/resource:$PayloadZip,payload.zip" "/resource:$root/NOTICE.txt,NOTICE.txt" "/resource:$root/config/models.json,defaults.models.json" "/resource:$root/config/settings.json,defaults.settings.json" (Join-Path $root 'src/Program.cs') (Join-Path $root 'src/Settings.cs') $buildInfo
if ($LASTEXITCODE -ne 0) { throw 'C# compilation failed.' }
$hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$OutputPath.sha256", "$hash  $([IO.Path]::GetFileName($OutputPath))`n")
$sourceCommit = $null
$sourceDirty = $null
if (Test-Path -LiteralPath (Join-Path $root '.git')) {
    $sourceCommit = git -C $root rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve source commit.' }
    $sourceChanges = git -C $root status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect source working tree.' }
    $sourceDirty = [bool]$sourceChanges
}
$manifest = [ordered]@{
    schemaVersion = 1
    name = 'pi-portable'
    version = $version
    platform = 'windows-x64'
    sourceCommit = $sourceCommit
    sourceDirty = $sourceDirty
    executable = [ordered]@{ name = [IO.Path]::GetFileName($OutputPath); sha256 = $hash }
    signature = [ordered]@{ status = 'unsigned' }
    payloadSha256 = $ExpectedSha256.ToLowerInvariant()
    upstream = $(if ($official) { $release } else { $null })
    webAccess = $(if ($official) { $webRelease } else { $null })
    subagents = $(if ($official) { $subagentsRelease } else { $null })
    presets = [ordered]@{
        modelsSha256 = (Get-FileHash -LiteralPath (Join-Path $root 'config/models.json') -Algorithm SHA256).Hash.ToLowerInvariant()
        settingsSha256 = (Get-FileHash -LiteralPath (Join-Path $root 'config/settings.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
[IO.File]::WriteAllText("$OutputPath.build.json", ($manifest | ConvertTo-Json -Depth 8) + "`n")
Write-Output "Built $OutputPath ($((Get-Item -LiteralPath $OutputPath).Length) bytes)"
