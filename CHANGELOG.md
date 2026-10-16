# Changelog

Wrapper versions are independent of upstream Pi versions.

## Unreleased

- Added a daily stable-Pi update workflow with archive/checksum verification, idempotent draft PR creation, and explicit Windows/Linux CI dispatch. Merging, tagging, and publishing remain manual.
- Case metadata and version checks now derive the upstream version from build pins rather than a hard-coded value.

## 0.5.0 — 2026-10-15

- Bundled checksum-pinned pi-web-search 1.7.0 in both executables. No npm or extra installation is needed on target systems; Ollama Cloud search/fetch reuses the existing saved API key.
- Added /web on, /web off, and /web status. Web tools start disabled, require session-level consent, and turn off for collection and case analysis. Turning them off cancels active web requests.
- Preserved unmodified package source and attribution under vendor/pi-web-search, with package/archive integrity and per-file hashes recorded in web-search-release.json and release build manifests.
- Added packaged-runtime tests for search, URL retrieval, citations, rate-limit errors, cancellation, opt-in denial, and isolation from IR collection/analysis.

Web tools send queries and supplied URLs to the configured search provider and can incur charges. Restrict them to public research; tool-selection controls do not restrict network use through general shell commands. Live paid-provider access is not exercised by automated tests.

## 0.4.0 — 2026-10-15

- Bundled IR commands: /triage, /host, /processes, /network, /persistence, /logons, and /timeline. Fixed collectors run with time/output limits and record failures and partial output.
- Added --portable-triage for collection without an API key or model request. New case folders contain host/operator/version metadata, raw evidence, collector audit records, a collection report, and SHA-256 manifests.
- Added /case to verify and open transferred cases, /analyze for explicit model analysis with inspection tools, and /report for Markdown/JSON exports with validated artifact hashes and citation line ranges.
- Collection and model analysis are separate. Reports distinguish observations, hypotheses, confidence, unanswered questions, and recommended next steps.
- Windows extraction briefly retries a blocked final directory rename to tolerate transient antivirus/indexer locks without discarding staged files.

Live collection leaves a footprint and has limited coverage. Hashes detect changes relative to the manifest, not authenticity on a compromised host. AI findings require analyst review. Dedicated web search is not included in this milestone.

## 0.3.0 — 2026-10-15

- Added a single distributable Linux x64 executable embedding official Pi 1.3.0, ripgrep, and fd.
- Native Go launcher with portable config/sessions/temp files, first-run hidden key setup, saved-key reuse, and Bash defaults.
- Linux archive/runtime integrity checks, symlink rejection, extraction locking, and owner-only key/file permissions where supported.
- Native process replacement preserves arguments, terminal input, signals, and child exit codes.
- Added Go unit tests, Linux pseudo-terminal integration tests, and actual Bash/search smoke tests on Ubuntu 22.04 and 24.04.
- Releases now publish both Windows and Linux executables with checksums/manifests. Existing Windows behavior is unchanged.

Linux requires compatible glibc, Bash, and executable filesystems. ARM64 and Alpine/musl are not supported by this artifact. Saved keys remain plaintext.

## 0.2.1 — 2026-10-15

- Embedded an original Pi shield icon in the Windows executable, with seven sizes from 16 to 256 pixels.
- Added editable SVG artwork and a PowerShell icon-generation script.
- Documented double-click launch and choosing an investigation working directory.

No changes to authentication, runtime, or default tools.

## 0.2.0 — 2026-10-15

- First interactive Ollama launch prompts for a hidden API key, saves it on the portable drive, and starts Pi.
- Later launches reuse `agent/ollama-cloud.key`; `OLLAMA_API_KEY` can override it without changing the file.
- Added `--portable-setup` to replace the saved key, with Escape/Ctrl+C cancellation and empty-input handling.
- Automation, redirected input/output, RPC, utilities, other providers, existing Pi auth, and resumed sessions avoid automatic setup.
- Added hidden-input tests and saved-key authentication coverage in the real-tool smoke test.

Saved keys are plaintext for cross-system portability. Upstream Pi and bundled tool versions are unchanged.

## 0.1.0 — 2026-10-15

Initial public release of Pi Portable, an Incident Response distribution fork of the Pi coding agent.

- Single Windows x64 EXE embedding official Pi 1.3.0 and its assets.
- Bundled ripgrep 15.2.0 and fd 10.5.0, without target-side downloads.
- Ollama Cloud / DeepSeek 4.1 Flash preset with environment-based credentials.
- Portable configuration, sessions, and temporary files; `PI_PORTABLE_HOME` override.
- PowerShell and file-reading/search tools enabled by default.
- Disabled startup downloads, telemetry, workspace discovery, and MCP for normal launches.
- Runtime integrity checks, traversal/junction checks, concurrent extraction locking.
- Launcher tests, real-tool smoke test using a fake model, Windows CI, SHA256 checksums, and a build manifest.

Known limits: unsigned, self-extracting EXE; Windows x64 only; no sandbox or forensic write blocker. Live account access and interactive console behavior require further validation.
