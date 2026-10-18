# Bundled subagents

Roles requesting Bash are mapped to native PowerShell before their tools are intersected with the profile; only `full` permits commands. Ambient project/user/package roles cannot override bundled agents. Child results use inline output; normal extension transcripts/result artifacts are still retained in portable state.

Pi Portable embeds [pi-subagents](https://pi.dev/packages/pi-subagents) **0.79.1**, its published source/resources, MIT license and runtime dependencies. No npm, external Pi installation or startup download is required. Enable it for a launch:

```powershell
.\pi-portable.exe --subagents --profile edit --project C:\Projects\MyApp
.\pi-portable.exe --subagents --web --project C:\Projects\MyApp
```

Alternatively add `"subagents": { "enabled": true }` to `portable.json`. The default is disabled; `--no-subagents` overrides configuration. Web access is a separate opt-in and retains its own allowlist/search-provider settings.

The `subagent` tool discovers built-in roles (`action: "list"`) and runs `scout`, `researcher`, `evidence-auditor`, `worker`, `reviewer`, `oracle` and `delegate`. All children use the configured `portable` provider/model, session credentials, TLS/proxy settings and model fetch guard. Their tools are intersected with the current profile; choosing `worker` under `review` does not grant write access. Child extensions, skills, project instructions, external machines and additional providers are disabled. When web access is enabled, permitted child web tools use the same separate network scope as the parent. Unsupported upstream research tools are omitted.

Supported model tool calls:

```json
{"agent":"reviewer","task":"Review the parser","async":false}
{"tasks":[{"agent":"oracle","task":"Inspect parsing"},{"agent":"reviewer","task":"Inspect tests"}],"async":false}
{"chain":[{"agent":"worker","task":"Fix the parser"},{"agent":"reviewer","task":"Review the preceding changes"}],"async":false}
```

The portable adapter executes structured batches through foreground SDK sessions inside the bundled Pi process. Parallel results preserve input order; chains append the preceding step's text and stop on a failed step. Each batch permits 1–8 flat `{agent,task}` steps; upstream nested parallel steps, `as` names and template expansion are unavailable. Run/session spawn ceilings are 8/32, and children cannot create grandchildren. Parallel writers share the working directory, so assign separate files or use a chain for dependent edits.

Detached/background runners, scheduling, JavaScript workflows, automatic worktrees, external CLI agents, panes, watchdog, agent-management and extension bindings are disabled. The upstream detached runner is experimental on Windows. Upstream workflow workers crashed the pinned Windows Bun runtime during testing; the adapter avoids that path. Bundled prompts/skills/docs remain available as resources, but are not automatically loaded into agent sessions. Some upstream help and slash-command text describes features unavailable in this distribution.

Child sessions and result artifacts stay under the selected state directory, partitioned with the parent project. Temporary subagent resources use `<state>\subagents\<project-id>`; parent/session metadata can also remain in `<state>\runs`. Transcripts can contain source code and tool output. The launcher never saves injected credentials, but an agent can reproduce information it has been given; these profiles remain application controls rather than a Windows sandbox. `--no-session` does not promise to suppress all extension artifacts; disable subagents for runs where no extension artifacts may be retained.

See `subagents-release.json` for package integrity, source commit, dependency versions and every embedded file hash. `scripts/bundle-subagents.mjs` documents the derived bundle's adaptations; the published upstream source remains unchanged.
