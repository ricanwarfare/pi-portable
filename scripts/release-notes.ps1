[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^v[0-9]+\.[0-9]+\.[0-9]+$')]
    [string]$Tag,
    [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = $Tag.Substring(1)
$lines = @(Get-Content -LiteralPath (Join-Path $root 'CHANGELOG.md'))
$heading = '^##\s+' + [regex]::Escape($version) + '(?:\s|$)'
$start = -1
for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match $heading) { $start = $index + 1; break }
}
if ($start -lt 0) { throw "CHANGELOG.md has no release section for $Tag" }
$end = $lines.Count
for ($index = $start; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match '^##\s') { $end = $index; break }
}
if ($end -le $start) { throw "CHANGELOG.md has an empty release section for $Tag" }
$body = ($lines[$start..($end - 1)] -join "`n").Trim()
if (-not $body) { throw "CHANGELOG.md has an empty release section for $Tag" }
if (-not $OutputPath) { $OutputPath = Join-Path $root '.build/release-notes.md' }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force (Split-Path $OutputPath -Parent) | Out-Null
$notes = @(
    "# Pi Portable $Tag",
    '',
    'A portable internal-endpoint distribution of the [Pi coding agent](https://github.com/earendil-works/pi).',
    '',
    $body,
    '',
    "See the [README](https://github.com/ricanwarfare/pi-portable/blob/$Tag/README.md) for downloads, setup, prerequisites, and enterprise execution limitations.",
    ''
) -join "`n"
[IO.File]::WriteAllText($OutputPath, $notes)
Write-Output "Generated release notes for $Tag at $OutputPath"
