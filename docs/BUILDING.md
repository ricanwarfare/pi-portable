# Building and releasing

## Windows requirements

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

The executable icon is embedded from `assets/pi-portable.ico`; no separate icon is needed on a response drive. Its original vector artwork is in `assets/pi-portable.svg`. To regenerate the seven-size ICO using Windows System.Drawing, run `pwsh -NoProfile -File scripts/generate-icon.ps1`. If changing the design, update both the SVG and the drawing paths in that script. A preview PNG is written under `.build/`.

Launcher tests cover quoting, stdin, exit codes, state paths, copied-EXE behavior, concurrent extraction, archive traversal, junctions, tamper detection, and configuration preservation. The runtime test redirects the Ollama preset to a localhost fake model and exercises real PowerShell/read/grep/find/ls with a system-only PATH. It checks model selection, Bearer authentication, sessions, and disabled workspace discovery.

No provider keys are needed. Tests require permission to listen on localhost and create a temporary directory junction. Artifacts remain in `.build/` for inspection. Interactive behavior, a clean Windows VM, and live Ollama access are separate manual checks.

## Linux build and test

Build with Go 1.27.2 and Python 3 on Linux, or cross-compile from Windows using the same tools. No third-party Go modules are needed. Python and Go are build tools only; they are not required on the target. CI pins Go 1.27.2; the build manifest records the compiler actually used.

```bash
python3 scripts/build-linux.py
cd src/linux
go test -v ./...
go vet ./...
cd ../..
python3 tests/linux-launcher.py
node tests/runtime-smoke.mjs
```

Outputs are `dist/pi-portable-linux-x64`, its `.sha256`, and its `.build.json` manifest. Build downloads use exact pins in `upstream-linux-release.json`. The script validates archive paths/types, assembles a deterministic compressed payload, and embeds it with presets and notices in a statically linked Go launcher. Pi inside still needs compatible glibc Linux and Bash. The target needs no compiler or package manager.

Prepared assets are generated under the ignored `src/linux/bundle/`; downloads are cached in `.build/linux-downloads/`. `--prepare-only` prepares assets without compiling. Build before running Go tests so embedded assets exist.

Linux integration tests use a real pseudo-terminal to check setup, hidden input, replacement/cancellation, `0600` key permissions, copied-EXE behavior, concurrent startup, config preservation, tamper detection, and symlink rejection. The shared runtime test uses Bash on Linux and PowerShell on Windows. CI tests Ubuntu 22.04 and 24.04; the Ubuntu 22.04 artifact is published. Live provider access and other distributions remain separate checks.

## Update dependencies

1. Review official upstream releases and compatibility changes.
2. Update exact URLs and SHA256 pins in `upstream-release.json` and `upstream-linux-release.json`, verifying the publisher's metadata.
3. Review `config/` changes; never add real credentials.
4. Update documented versions, notices, and changelog.
5. Build and run both test commands.

Investigate checksum mismatches rather than bypassing validation.

## Publish a release

1. Update `version.json`, README compatibility, and changelog. Wrapper and Pi versions are independent.
2. Add a `## <version>` section to `CHANGELOG.md` covering the changes and relevant limits. Release notes are generated from that section; per-release Markdown files are not required.
3. Push the reviewed commit to `main` and wait for Windows and both Ubuntu jobs to pass.
4. Tag that commit `v<version>` and push the tag.

Tag CI checks the version, builds and tests both platforms, then publishes both executables with checksums and manifests to GitHub Releases. Only the release job has repository-content write permission. Release files are tested build outputs, not a developer's data directory. Set the Linux executable bit after downloading with `chmod +x`.

Review the published downloads and notes. Never publish credentials, caches, sessions, local reference checkouts, or evidence.

The tracked repository contains source, tests, configuration, build/release scripts, original icon artwork, licenses, and maintained documentation. Generated binaries are distributed through GitHub Releases. Build caches, prepared bundles, reference checkouts, sessions, and credentials remain local under `.gitignore` rules.
