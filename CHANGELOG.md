# Changelog

Wrapper versions are independent of upstream Pi versions.

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
