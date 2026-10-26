# Changelog

## 1.4.0

- Update the unmodified official Windows x64 Pi runtime from 1.3.0 to 1.4.0, keeping the portable version aligned.
- Verify the downloaded ZIP against GitHub's SHA256 asset digest and retain the existing tool/extension pins and portable defaults.
- See [upstream release notes](https://github.com/earendil-works/pi/releases/tag/v1.4.0) for Pi changes. Full Windows build, offline/internal-network, settings, credential, web and delegation tests are required before publication.
- Add a daily/manual official Pi update check with downloaded SHA256/size verification, aligned version/pin/documentation changes, and update PRs with explicitly dispatched Windows build/tests.
- Add a main-only Publish release button that derives the merged version, refuses existing releases/conflicting tags and dispatches the existing tested/signing-aware publication gate. Runtime startup remains offline; portable-copy updates retain the state folder.
- Test update validation, idempotency, tampering/downgrade rejection, check-only behavior and safe tag/publication retries using synthetic fixtures.
- Keep the third-party notices table and the runtime version test aligned with the pinned Pi version; the update automation maintains both, and a repository alignment test fails when the release files disagree.

## 1.3.0

- Publish the first GitHub release of Pi Portable, numbered to match the bundled official Pi 1.3.0 runtime. Earlier 0.x versions were development builds of this distribution; the upstream Pi binary remains unmodified.
- Ship a single Windows x64 executable with bundled ripgrep/fd, pi-agent-web-access 1.1.2 and pi-subagents 0.79.1. No target-side Node.js/npm installation or startup download is required.
- Include double-click setup and `/portable` settings for the provider, model, project, coding permissions, persistent web/delegation preferences and optional Windows-encrypted remembered model keys.
- Support explicit internal OpenAI-compatible, Ollama, Azure and custom Chat Completions/Responses endpoints, verified HTTPS with additional PEM CAs, proxy routing and project-partitioned sessions.
- Preserve session-only CLI credentials by default, exact model-route transport policy, review/edit/full tool profiles and credential separation for optional web tools. Foreground single, parallel and chained delegation is supported; detached runners and arbitrary workflow scripts remain disabled.
- Run all 33 Windows tests before publication and attach the executable, SHA256 checksum and clean-source build manifest. This release is unsigned; enterprise execution policy still applies.

## 0.4.0

- Add native Windows first-run settings for double-click launches, remembered provider/model/project, API/auth format, CA/proxy options, coding profile, web access and delegation.
- Add `/portable`, `/web` and `/delegation` settings commands; Save persists preferences and automatically restarts with the selected project's latest saved session.
- Add optional account-bound DPAPI model-key storage scoped to endpoint/authentication. Keep CLI terminal entry session-only, preserve environment overrides, support forgetting/replacing keys and recover from missing/unreadable saved keys through setup.
- Test real Windows form controls, preference restoration, DPAPI encryption/scope/tampering/relocation, environment overrides, forgetting keys, automatic restart and actual packaged command registration.

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
