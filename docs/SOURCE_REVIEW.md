# Source review and derivation

Reference source: `ricanwarfare/pi-response` commit `845c7dba1d250564797d961cceb21bccb7a62ea1`. Upstream runtime source reviewed at Pi v1.3.0, commit `71023aec1546d6d677a65669c5665c0927ce0dd0`. The reference repository was cloned for inspection and left unchanged.

The inspection covered the Windows C# launcher, payload/build/release manifests, Windows and Linux release workflow, signing/finalization gates, credential input fixtures, launcher/runtime/session tool tests, source update scripts, embedded web package and IR workflow, and runtime compatibility documentation. The new repository retains the Windows infrastructure and excludes the Linux distribution and IR/web feature trees.

| Finding | Implemented decision |
| --- | --- |
| pi-response ships an official, unmodified Pi executable | Keep the pinned distribution and bundle rg/fd, rather than introduce a target-side dependency installer |
| Its extraction code checks archive containment, reparse points, unexpected files and per-file hashes | Reuse those primitives, with independent fixtures for corruption/traversal/concurrency |
| Its default endpoint and saved-key workflow are Ollama Cloud specific | Require a configured endpoint and use process-only credentials; remove saved-key methods |
| Pi supports environment interpolation in provider definitions, but stored auth has higher precedence | Generate a fresh agent directory per launch and reference a runtime environment key; avoid the host's auth/settings |
| Pi's offline switch disables startup catalog/version traffic, not all explicit networking | Keep offline mode, remove web search, add an exact-endpoint fetch guard, document its OS/network limits |
| Pi's OpenAI adapters use the injectable/global fetch transport | Install the guard synchronously from a bundled extension; test actual native SSE requests and tools |
| Pi catches extension initialization exceptions and can continue | Exit on invalid guard initialization instead of allowing an unguarded model call |
| Resumed sessions restore their prior active tools | Apply a launcher allowlist plus extension tool-call enforcement on every session/turn |
| Pi filters continuation by recorded cwd, even with a custom session directory | Partition by project and offer a bounded session-file fork after a project moves |
| Legacy .NET target metadata caused long-path extraction failure in the actual nested checkout | Declare .NET Framework 4.8 and long-path/asInvoker manifest; validate from nested paths |
| Signing changes the distributed EXE bytes | Reuse final publisher/timestamp/source validation and regenerate final checksums/manifests |

The model transport is intentionally limited to Chat Completions and Responses. Azure's deployment route/version and API-key header are handled explicitly. Custom compatible header authentication uses environment interpolation, without credential commands in persisted models.json.

Validation uses real packaged-runtime local services, with no public AI endpoint or production credentials. See VALIDATION.md for the final local results and the repository Actions tab for remote results.

## Optional package review for 0.2.0

The user requested pi-agent-web-access from its Pi package listing. Reviewed its published 1.1.2 package (npm SHA512 recorded in web-access-release.json), `index.ts`, `search.ts`, `extract.ts`, `utils.ts`, compiled ESM, manifest and declared dependencies. The author's repository source identity is c4bd7b9d459bc510283b91202449abb4c2f7bfc6. The npm archive contains no standalone LICENSE, so the root MIT license from that source commit is retained separately.

The package performs HTTP Exa MCP search when no key is set, Exa API searches with a key, Brave search/fallback, direct page extraction via Readability/linkedom/turndown and optional Jina fallback. Its global home-directory usage counter was incompatible with portable state, so the derived bundle redirects that ledger into PI_PORTABLE_WEB_STATE. The complete original npm source remains unmodified beside the bundle. Optional canvas is disabled to avoid native modules on target machines. All 19 runtime dependencies are bundled with their own notices and no remaining non-SDK/non-builtin external imports.

The adapter requires explicit web enablement, scopes web fetch permissions to those tools, strips model authorization/headers, keeps search keys on their provider/mirror routes, rechecks content redirects/allowlists, and blocks Jina until independently enabled. It uses Pi's TypeScript extension loader so embedded SDK imports resolve offline. The launcher includes enabled web tools in the initial allowlist; Pi otherwise suppresses extensions excluded by that list. No Pi package-manager command or target-side installation is needed.
