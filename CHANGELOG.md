# Changelog

## 0.2.0

- Bundle the requested pi-agent-web-access 1.1.2 extension with all 19 runtime JavaScript dependencies, original source and license notices, and checked file hashes.
- Add opt-in `--web` / `--no-web`, `web_search` and `fetch_content` to any coding profile; default startup stays offline.
- Separate web-tool networking from model networking, keep model credentials off web requests, support content origin allowlists and compatible internal search mirrors, and make Jina fallback an independent opt-in.
- Keep Exa usage state inside the chosen portable/user-profile state directory; search keys remain process-environment only.
- Test actual packaged Exa MCP/direct, Brave, HTML extraction, default-off behavior, credential separation and concurrent network scopes without public API calls.

## 0.1.0

- Derive a separate Windows coding-agent distribution from pi-response, preserving checksum-pinned single-EXE packaging, safe extraction, release provenance and optional Azure signing.
- Remove incident-response extensions, case/evidence features, web search and public cloud presets.
- Require explicit OpenAI-compatible/Ollama/Azure/custom endpoint configuration, with session-only credentials and per-launch agent configuration.
- Add portable/user-profile state, Git-root-aware project partitions, moved-project session forks and review/edit/full profiles reapplied on resume.
- Add offline startup, exact-endpoint fetch policy, strict TLS with extra PEM CAs, proxy support and redirect rejection.
- Add native launcher, packaged tool/runtime, HTTPS/proxy, relocation, credential persistence and signing-gate tests.
