# Configuration

`--configure` writes a starter file without extracting the runtime or contacting any service. It refuses to overwrite an existing file. Edit it with a text editor. Unknown top-level fields are rejected.

```json
{
  "kind": "openai",
  "baseUrl": "https://model.internal.example/v1",
  "model": "company-coder",
  "auth": "bearer",
  "keyEnv": "PI_PORTABLE_API_KEY",
  "profile": "review",
  "proxy": "env",
  "caFile": "company-ca.pem",
  "contextWindow": 32768,
  "maxTokens": 4096
}
```

Remove `caFile` or set it to `""` when the bundled TLS trust is sufficient. The runtime uses Bun's TLS implementation; do not assume a certificate trusted only by the Windows store is automatically trusted. A PEM bundle adds your approved roots to the runtime roots, retains chain and hostname verification, and does not modify the machine certificate store. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`; the launcher overrides that variable to keep validation enabled.

| Field | Meaning/default |
| --- | --- |
| `kind` | `openai`, `ollama`, `azure`, `custom`; default `openai` |
| `baseUrl` | Required; HTTP(S) API base, without credentials/query/fragment. Include `/v1` when required. No public endpoint default or automatic probing. |
| `model` | Required model ID/deployment. No automatic discovery or downloads. |
| `api` | `openai-completions` (default) or `openai-responses` |
| `auth` | `bearer`, `api-key`, `none`; default bearer, except Ollama none and Azure api-key |
| `keyEnv` | Process variable supplying a key; default `PI_PORTABLE_API_KEY` |
| `profile` | `review` (default), `edit`, `full`; overridden by `--profile` |
| `proxy` | `env` (default), `direct`, or HTTP(S) proxy origin without credentials/path |
| `caFile` | PEM trust bundle path, relative to this config file or absolute |
| `allowHttp` | Must be boolean `true` to permit unencrypted non-loopback endpoints. Loopback HTTP is permitted by default. |
| `apiVersion` | Required for Azure deployment routes, e.g. `2024-10-21`; appended to the actual model request |
| `contextWindow`, `maxTokens` | Model limits; default 32768 and 4096 |
| `headers` | Object of header names/values; values can use `${VARIABLE}` interpolation from the process environment |
| `compat` | Pi OpenAI compatibility object; default disables store, developer role and reasoning effort, and uses max_tokens |
| `web` | Optional web tool configuration; disabled by default. See WEB_ACCESS.md. `--web`/`--no-web` override it for one launch. |
| `subagents` | Optional `{ "enabled": true }`; disabled by default. `--subagents`/`--no-subagents` override it. See SUBAGENTS.md for supported foreground operations. |

Proxy `env` delegates `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY` (and their lowercase variants) to the bundled Bun transport. Explicit proxy URLs still honor `NO_PROXY`. `direct` disables proxying. Proxy authentication may be supplied in the process proxy environment URL; do not commit it into configuration. PAC, Windows integrated authentication (NTLM/Kerberos), SOCKS, automatic OS proxy discovery, and mutual TLS client certificates are not implemented/tested here; use an approved local gateway if required. A proxy may observe request destinations; your enterprise trust configuration controls TLS inspection.

Headers such as `Authorization`, `api-key`, `Proxy-Authorization`, Host and framing headers cannot be overridden. Choose `auth` for standard authorization. For custom authentication use environment-backed headers, for example `"headers": {"X-Company-Token": "${COMPANY_TOKEN}"}`, with `"auth": "none"`. Literals are supported for non-secret routing headers; putting a secret literal there persists it in your own configuration. Config files do not support shell commands or Pi's `!command` credential expressions.

The Azure example uses the deployment Chat Completions route. Azure's newer compatible `/openai/v1` service can instead use `kind: openai`, the corresponding base URL, and the authentication mode your service supports. This distribution does not refresh expiring tokens.

Supported upstream value options: `--name`/`-n`, `--thinking`, `--mode` (`rpc`, `json`, `text`), `--system-prompt`, `--append-system-prompt`, `--tui-mode`. Supported flags: `--print`/`-p`, `--continue`/`-c`, `--resume`/`-r`, `--no-session`, `--verbose`, `--help`/`-h`, `--version`/`-v`. The wrapper adds endpoint, model, policy and tools; unsupported options are rejected. `--version` displays Pi's version; `--portable-info` displays the distribution version and state paths. `--help` shows upstream help, including flags deliberately unavailable through this wrapper; use this file for the supported surface.

RPC automation must use the same configured provider and profile. The model tool-call hook enforces the profile even if a client changes visible tools. RPC itself and user-authored shell operations are not an operating-system sandbox.
