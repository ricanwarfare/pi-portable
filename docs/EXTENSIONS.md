# Extension evaluation

Reviewed 2026-10-16 for Pi Response's pinned Pi 1.3.0, Windows x64, and Linux x64 builds. This is a shortlist for evaluation, not a claim that these packages are bundled or have passed our packaged-runtime tests. No new extension was installed as part of the review.

## Popularity snapshot

These are leading relevant extensions in the [Pi package catalog](https://pi.dev/packages?type=extension), using its reported downloads/month on the review date. Counts include automation and dependency installs; they do not measure unique users, security, or portability. The catalog changes frequently.

| Package | Catalog downloads/month | Pi Response assessment |
| --- | ---: | --- |
| `pi-mcp-adapter` | 1.6M | Native Pi already covers baseline MCP needs |
| `pi-web-access` | 762.1K | Richer web/document support; larger integration scope |
| `pi-subagents` | 609K | Defer pending standalone Windows validation |
| `pi-mcp-extension` | 327.3K | Avoid adding another baseline MCP implementation |
| `@langfuse/pi-observability-plugin` | 322.1K | Tracing destination needs a separate privacy decision |
| `@juicesharp/rpiv-ask-user-question` | 300.9K | Strong candidate for analyst interaction |
| `@juicesharp/rpiv-todo` | 197.9K | Strong candidate for investigation checklists |
| `pi-powerline-footer` | 104.6K | Prefer a smaller case-specific status display |
| `@gotgenes/pi-permission-system` | 68.4K | Separate permission-policy evaluation needed |
| `pi-web-search` | 51.9K | Already bundled behind our opt-in adapter |

## Recommended evaluation order

### 1. Investigation checklists

[`@juicesharp/rpiv-todo`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo), reviewed version 2.13.8, could track acquisition, process/network review, persistence, timeline, unanswered questions, and handoff tasks. It has no native runtime dependency or separate model key. Task state uses Pi session entries, so checklist contents can persist in conversation files.

Before bundling, pin and review its `@juicesharp/rpiv-config` dependency, verify Pi's embedded TypeBox imports, add its tool deliberately to the launcher allowlist, and test Windows/Linux standalone operation. This is a proposed addition, not an available `/todo` command in Pi Response.

### 2. Structured analyst questions

[`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question), reviewed version 2.13.8, could collect case scope, time windows, host roles, and analyst decisions through explicit choices. The package supports terminal/RPC interaction without making independent model requests. Pi 1.3.0 does not provide a native `ask_question` tool merely because the name appears in a CLI-help example.

Both RPIV candidates use [`rpiv-config`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-config), which reads XDG/host configuration independently of Pi's agent directory. A bundle must isolate that configuration inside the portable home, retain source/license pins, and test host-config rejection. Loading an extension must not bypass explicit `--tools` restrictions or case-analysis privacy controls.

### 3. Case-aware status display

[`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer), reviewed version 0.20.1, offers useful model/context/cost displays and an ASCII preset. Its behavior also includes prompt queues, Git subprocesses, optional managed shells/history, and optional model-generated loading messages. Those features require review even when the goal is appearance.

For this project, a small built-in status display showing the active case, host, provider, web state, and incomplete collector count is a better next design candidate. This is our recommendation, not a current feature.

## Useful packages to defer

- **Subagents:** [`pi-subagents`](https://github.com/nicobailon/pi-subagents), reviewed version 0.78.0, is useful for independent evidence reviews. Its [documented standalone boundary](https://github.com/nicobailon/pi-subagents/blob/main/docs/standalone-background.md) validates Pi 0.86.1 Linux x64 and calls Windows experimental. Pi Response uses 1.3.0 and needs its own dual-platform lifecycle tests. Child processes must inherit case scope, network/consent limits, and portable storage; extra requests and session artifacts need disclosure. Do not enable autonomous collection/remediation as an incidental side effect of adding reviewers.
- **Permissions:** [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system), reviewed version 40.2.2, is promising for command approvals. It brings Zod, tree-sitter/WASM resolution, and portable configuration work. Its [shell classification](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/access-intent/tool-kind.ts) is Bash-oriented; do not claim equivalent PowerShell command/path analysis. A whole-tool ask/deny policy is different from parsing PowerShell safely. This would add an application policy layer, not an OS sandbox.
- **Broader web access:** [`pi-web-access`](https://github.com/nicobailon/pi-web-access) adds document/media extraction and more search choices. Those capabilities need separate dependency, cache, network, and disclosure review. Keep the smaller tested `pi-web-search` bundle until there is a concrete missing research task.
- **MCP adapters:** [native MCP in exact Pi 1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/mcp.md) already supports local/HTTP servers and authentication. Pi Response intentionally supplies `--no-mcp` on ordinary agent launches. A future analyst-workstation profile should evaluate native MCP first; installing an adapter is not a substitute for that design or for server dependencies.
- **Remote observability:** [Langfuse's Pi plugin](https://github.com/langfuse/pi-observability-plugin) traces prompts, generations, and tool activity. Do not add automatic evidence/session tracing to the target build. An approved analyst-workstation deployment could be evaluated separately with explicit data handling and endpoint controls.

## Bundle acceptance criteria

A candidate needs an exact source/package version and integrity pin, license retention, complete reviewed dependencies, no target-side install/download requirement, isolated portable configuration, explicit tool activation, and fake-provider tests against both shipped executables. Include cancellation and session changes, inherited case/web restrictions, missing dependencies, and sensitive-state persistence in those tests. None of the proposed packages is approved solely by its popularity count.
