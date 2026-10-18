# Changelog

## 0.3.0

- Document first-run setup, source builds, custom Chat Completions/Responses providers, authentication, internal CA/proxy configuration and common troubleshooting; add a copyable custom Chat Completions example.

- Embed pi-subagents 0.79.1, published source/resources, runtime dependencies, licenses and checked hashes.
- Add opt-in `--subagents` / `--no-subagents`, seven built-in roles, bounded foreground parallel tasks and sequential chains using the embedded Pi SDK.
- Keep child models, tools, credentials, web scope and state within portable configuration; disable detached Windows runners, workflow scripts, external agents, scheduling and automatic worktrees.
- Avoid a pinned Windows Bun workflow-worker crash by dispatching structured batches through foreground sessions.
- Test actual child sessions, role discovery, default/forced-off behavior, profile limits, model/async rejection, parallel overlap, chained results, child reads and web credential separation against local services.

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
