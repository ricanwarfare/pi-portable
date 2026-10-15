# Building and releasing

## Requirements

- Windows x64, .NET Framework 4.8, and its C# compiler (`Framework64/v4.0.30319/csc.exe`). No .NET SDK required.
- PowerShell 7 (`pwsh`).
- Node.js 22+ for tests.
- Network access for the first build's pinned downloads.

The build consumes official archives; it needs no Pi checkout or npm dependencies.

## Build and test

```powershell
pwsh -NoProfile -File .\scripts\build.ps1
node --test .\tests\launcher.test.mjs
node .\tests\runtime-smoke.mjs
```

Output is `dist/pi-portable.exe`, `dist/pi-portable.exe.sha256`, and `dist/pi-portable.exe.build.json`. The manifest records the wrapper version, source commit when available, dependency pins, and payload/executable hashes. It is provenance information, not a signature or exhaustive SBOM. Builds are not guaranteed to be bit-for-bit reproducible across machines.

The build validates archives against [upstream-release.json](../upstream-release.json), retains search-tool licenses, and embeds the distribution and configuration templates. Downloads are cached in `.build/` for subsequent offline builds. Use `-OutputPath` to choose another output. `-PayloadZip` and `-ExpectedSha256` are intended for test fixtures or deliberately supplied distributions; the archive must contain `pi.exe` at its root.

Launcher tests cover quoting, stdin, exit codes, state paths, copied-EXE behavior, concurrent extraction, archive traversal, junctions, tamper detection, and configuration preservation. The runtime test redirects the Ollama preset to a localhost fake model and exercises real PowerShell/read/grep/find/ls with a system-only PATH. It checks model selection, Bearer authentication, sessions, and disabled workspace discovery.

No provider keys are needed. Tests require permission to listen on localhost and create a temporary directory junction. Artifacts remain in `.build/` for inspection. Interactive behavior, a clean Windows VM, and live Ollama access are separate manual checks.

## Update dependencies

1. Review official upstream releases and compatibility changes.
2. Update exact URLs and SHA256 pins in `upstream-release.json`, verifying the publisher's metadata.
3. Review `config/` changes; never add real credentials.
4. Update documented versions, notices, and changelog.
5. Build and run both test commands.

Investigate checksum mismatches rather than bypassing validation.

## Publish a release

1. Update `version.json`, README compatibility, and changelog. Wrapper and Pi versions are independent.
2. Add `docs/releases/v<version>.md` covering changes, dependencies, validation, and limits.
3. Push the reviewed commit to `main` and wait for Windows CI to pass.
4. Tag that commit `v<version>` and push the tag.

Tag CI checks the version, builds and tests the executable, then publishes the EXE, checksum, and manifest to GitHub Releases. Only the release job has repository-content write permission. Release files are the tested build outputs, not a developer's runtime/data directory.

Review the published downloads and notes. Never publish credentials, caches, sessions, local reference checkouts, or evidence.
