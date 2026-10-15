# Changelog

Wrapper versions are independent of upstream Pi versions.

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
