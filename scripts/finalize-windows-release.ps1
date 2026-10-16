[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Unsigned', 'Signed')][string]$Mode,
    [string]$Path,
    [string]$ExpectedSubject,
    [string]$ExpectedCommit
)
$ErrorActionPreference = 'Stop'
if (-not $Path) { $Path = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist/pi-response.exe' }
$Path = (Resolve-Path -LiteralPath $Path).Path
$manifestPath = "$Path.build.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.name -ne 'pi-response' -or $manifest.platform -ne 'windows-x64' -or $manifest.executable.name -ne [IO.Path]::GetFileName($Path)) { throw 'Invalid Windows build manifest.' }
if ($ExpectedCommit -and $manifest.sourceCommit -ne $ExpectedCommit) { throw 'Build source commit does not match the release commit.' }
$hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($Mode -eq 'Unsigned') {
    if ($hash -ne $manifest.executable.sha256) { throw 'Unsigned executable checksum mismatch.' }
    if ($signature.Status -ne 'NotSigned') { throw 'Expected an unsigned executable; refusing to mislabel a signature.' }
    $details = [ordered]@{ status = 'unsigned' }
} else {
    if ([String]::IsNullOrWhiteSpace($ExpectedSubject)) { throw 'An expected publisher certificate subject is required.' }
    if ($signature.Status -ne 'Valid') { throw "Authenticode verification failed: $($signature.Status)" }
    if ($signature.SignatureType -ne 'Authenticode') { throw 'An embedded Authenticode signature is required.' }
    if (-not $signature.TimeStamperCertificate) { throw 'A trusted timestamp is required.' }
    if ($signature.SignerCertificate.Subject -cne $ExpectedSubject) { throw 'Signing publisher does not match the configured certificate subject.' }
    $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $signTool = Get-ChildItem -LiteralPath $sdk -Directory -ErrorAction SilentlyContinue |
        Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
        ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $signTool) { throw 'Windows SDK SignTool is required for release verification.' }
    & $signTool verify /pa /all /q $Path
    if ($LASTEXITCODE -ne 0) { throw 'SignTool signature verification failed.' }
    $details = [ordered]@{
        status = 'valid'
        subject = $signature.SignerCertificate.Subject
        certificateSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($signature.SignerCertificate.RawData)).ToLowerInvariant()
        timestampSubject = $signature.TimeStamperCertificate.Subject
    }
}
# Signing changes the EXE bytes; publish hashes of the final, verified file.
$manifest.executable.sha256 = $hash
$manifest | Add-Member -MemberType NoteProperty -Name signature -Value $details -Force
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12) + "`n")
[IO.File]::WriteAllText("$Path.sha256", "$hash  $([IO.Path]::GetFileName($Path))`n")
Write-Output "Windows release finalized: $($details.status)."
