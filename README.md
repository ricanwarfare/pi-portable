# Pi Portable

**Start here:** [Build, configure a custom provider, and use the agent](docs/GETTING_STARTED.md). Includes copyable commands, session-only authentication, internal HTTPS/proxy setup, subagents and web access.

**Double-click setup:** the first launch opens a settings window for your provider, model, key and project. Check **Web access** and **Delegation** to remember them for every launch. Inside the agent, **`/portable`**, **`/web`** or **`/delegation`** reopens settings; Save applies the choices by restarting and continuing the saved project session. Remembered model keys use Windows DPAPI encryption. See [in-app settings and key storage](docs/APP_SETTINGS.md).

A single Windows x64 executable for the [Pi coding agent](https://github.com/earendil-works/pi), configured for your internal model service. No administrator access, Node.js, Bun, npm, Git, or model download is required on the target. Windows with .NET Framework 4.8 and permission to execute applications from your chosen storage is required. PowerShell is needed only for the `full` tool profile.

Derived from [ricanwarfare/pi-response](https://github.com/ricanwarfare/pi-response), preserving its checksum-pinned official Pi packaging, safe extraction, bundled ripgrep/fd, Windows build provenance, and optional release signing. The upstream Pi binary is unmodified. Incident response, evidence collection, Ollama Cloud defaults and its original web adapter are removed. Optional web access uses the separately bundled `pi-agent-web-access` package. This is an independent distribution.

## Start without installing

Download `pi-portable.exe` and its `.sha256` from this repository's Releases when available, or build from source. Verify the checksum before transferring the executable to a writable folder or USB drive:

```powershell
$expected = (Get-Content .\pi-portable.exe.sha256 -Raw).Split(' ')[0]
if ((Get-FileHash .\pi-portable.exe -Algorithm SHA256).Hash -ne $expected) { throw 'Checksum mismatch' }
.\pi-portable.exe --configure
```

Edit `pi-portable-data\portable.json` beside the executable. Set `baseUrl` and `model` to the values your internal service requires. No endpoint is contacted during configuration. Then launch from your project:

```powershell
Set-Location C:\Projects\MyApp
E:\Tools\pi-portable.exe
```

The default `review` profile reads and searches files. For coding changes use `--profile edit`; add command execution with `--profile full`:

```powershell
E:\Tools\pi-portable.exe --profile edit --print 'Fix the parser and explain the changes.'
E:\Tools\pi-portable.exe --profile full --project C:\Projects\MyApp
E:\Tools\pi-portable.exe --continue
```

Command-line launches prompt for a hidden **session-only** key unless you explicitly save one in the settings window. Remembered keys are encrypted separately with Windows DPAPI for the current user; they are never saved as clear-text JSON or passed in command arguments. `PI_PORTABLE_API_KEY` (or the configured `keyEnv`) overrides a saved key. `--session-key` skips both sources and prompts again without changing the saved key. Redirected/RPC launches require an injected or remembered key. Avoid putting real keys in shell history. [Storage and portability details](docs/APP_SETTINGS.md).

## Optional web search and page reading

`pi-agent-web-access` **1.1.2** and its JavaScript dependencies are embedded in the EXE. Enable its `web_search` and `fetch_content` tools for a launch:

```powershell
E:\Tools\pi-portable.exe --web --profile edit --project C:\Projects\MyApp
```

Web access stays off by default. `--no-web` overrides an enabled config. Exa MCP search works without a search API key; `EXA_API_KEY` or `BRAVE_API_KEY` in the calling process environment selects authenticated services. Search sends queries to those external providers unless you configure compatible internal mirrors. Page fetching uses HTTPS by default; Jina fallback is separately disabled until `web.jina` is explicitly enabled. Search credentials are separate from model credentials, and its usage counter lives under the selected state directory. No npm installation or startup download is needed on the target. See [web configuration, allowlists and disclosure](docs/WEB_ACCESS.md).

## Optional subagents

`pi-subagents` **0.79.1** is also embedded. Launch with `--subagents` to delegate to built-in coding/research roles; combine `--web` for permitted researcher web tools. Children share your configured model and remain within the current coding profile. Single tasks, parallel batches and sequential chains run in the foreground. Detached runners and JavaScript workflows are disabled for this Windows distribution. See [usage and compatibility limits](docs/SUBAGENTS.md).

```powershell
E:\Tools\pi-portable.exe --subagents --web --profile edit --project C:\Projects\MyApp
```

## Endpoint configuration

The complete configuration reference and examples are in [docs/CONFIGURATION.md](docs/CONFIGURATION.md). Copy one of the examples in `config/` into your chosen state directory as `portable.json`.

| Service | Configuration |
| --- | --- |
| Internal OpenAI-compatible gateway | `kind: openai`, explicit `https://…/v1` base URL, model ID, `auth: bearer` |
| Local/internal Ollama | `kind: ollama`, explicit `http://localhost:11434/v1` or internal HTTPS URL, installed model ID, usually `auth: none` |
| Azure deployment API | `kind: azure`, base URL ending `/openai/deployments/DEPLOYMENT`, `apiVersion`, deployment name as `model`, `auth: api-key` |
| Custom compatible service | `kind: custom`, explicit base URL, `api: openai-completions` or `openai-responses`, auth and optional environment-backed headers |

Custom protocols must expose one of those APIs through a gateway; this wrapper does not implement arbitrary proprietary wire protocols. Ollama models must already be present on the server. Azure Entra tokens can be injected as session Bearer credentials; interactive Entra login/refresh is not implemented.

## State, projects, and tools

| Option | Behavior |
| --- | --- |
| Default | State beside the EXE in `pi-portable-data` |
| `--portable-storage user` | State in `%LOCALAPPDATA%\PiPortable`; works when the EXE directory is read-only |
| `--portable-home PATH` | Explicit state directory; overrides storage mode |
| `PI_PORTABLE_HOME`, `PI_PORTABLE_STORAGE` | Environment equivalents; command flags take precedence |
| `--portable-config FILE` | Configuration file outside the state directory; relative CA paths resolve against this file |
| `--project DIR` | Use the nearest enclosing Git root, detected without Git; otherwise DIR itself |
| `--project-id NAME` | Stable session partition ID; otherwise a hash of the absolute project root |
| `--continue`, `--resume` | Continue/pick a session in this project's partition |
| `--fork-session FILENAME.jsonl` | Fork a session from this partition into the current project directory, useful after moving the project |
| `--portable-info`, `--portable-notices` | Offline wrapper paths/provenance and license notice |
| `--no-session` | Ask Pi not to persist the conversation |

Sessions live under `<state>\sessions\<project-id>`. Generated per-launch configuration and temporary files live under `<state>\runs\<random-id>`. The verified runtime lives under `<state>\runtime\<payload-sha256>`. Normal exit removes generated model/settings/auth files; empty run directories and temporary/cache files may remain. Crashes can leave run files. These files and transcripts are not securely erased. Protect the state folder and remove old run directories when no launches are active.

Moving just the EXE creates new portable state beside its new location. To carry sessions and configuration, also copy `pi-portable-data`. Project paths are recorded in transcripts; moving a project requires the same `--project-id` and `--fork-session`, because Pi's normal continuation filters by its recorded working directory. Configuration paths to CA bundles should be relative for relocation. Different absolute Git roots have separate sessions unless you deliberately share an ID.

| Profile | Declared and permitted model tools |
| --- | --- |
| `review` (default) | read, grep, find, ls |
| `edit` | review tools plus write, edit |
| `full` | edit tools plus native powershell |

Profiles are reapplied on resumed sessions and checked when tools execute. Workspace instructions, extensions, skills, prompt templates, themes and MCP are not automatically loaded. Files remain accessible through the tools. Upstream provider/tool/extension/auth/package flags and management subcommands are rejected to preserve wrapper policy. Use `--` before prompt text that starts with an option or subcommand name. Supported upstream flags are documented in [CONFIGURATION.md](docs/CONFIGURATION.md).

## Network and enterprise boundaries

Startup uses the bundled catalog and search utilities, disables telemetry and update/catalog checks, and never downloads dependencies. An actual model call requires access to your explicitly configured endpoint. The bundled fetch guard limits model requests to that exact origin and API path, applies credentials only there, keeps TLS validation on, and rejects redirects. It supports additional PEM CAs, direct connections, or HTTP(S) proxies and `NO_PROXY`. Proxy routing follows the packaged Bun runtime; see [Bun's transport documentation](https://bun.sh/docs/runtime/networking/fetch).

This is an application policy, **not a Windows sandbox or firewall**. An explicitly configured public URL is treated as an intentional endpoint. PowerShell, user-entered shell commands, other native subprocesses, upstream interactive commands, and future upstream non-fetch network transports are outside the fetch guard. Enforce a strict machine-wide ban on public network access using enterprise firewall/proxy policy. Tests use only local model/proxy servers and synthetic credentials; no public model account is needed. See [docs/SECURITY.md](docs/SECURITY.md) for the tested scope.

The executable is **unsigned until a signing identity is configured**. Checksums verify bytes, not publisher identity. SmartScreen, AppLocker, WDAC, antivirus rules, removable-drive policies, and extracted-child execution rules can still block it. The launcher requests `asInvoker` and does not elevate, install certificates, change execution policy, or work around enterprise controls. PowerShell profiles/commands are subject to your organization's policy; build/test scripts may also be blocked. Request IT approval or an approved signed distribution when necessary. [Signing setup](docs/CODE_SIGNING.md).

## Build and validate

On a Windows development machine with .NET Framework 4.8, PowerShell 7, Node.js 22+ and Git's OpenSSL (test certificates only):

```powershell
git clone https://github.com/ricanwarfare/pi-portable.git
Set-Location pi-portable
.\scripts\build.ps1
.\scripts\test.ps1 -RequireStandardUser
```

The first build downloads hash-pinned archives. Subsequent builds reuse `.build` and work offline. To use an internally mirrored archive, retain the expected hash in `upstream-release.json` and populate the cache. `-PayloadZip FILE -ExpectedSha256 HASH` builds a custom/fixture payload and marks official upstream metadata absent; that ZIP must include `pi.exe`, the policy modules in `portable/`, and any required tools. Custom payloads are your responsibility.

Outputs are `dist/pi-portable.exe`, `.sha256`, and `.build.json`. Tests include native launcher fixtures, actual bundled coding, web and subagent tools, resumed profiles, moved-project forks, internal HTTPS, untrusted CA rejection, explicit and environment proxies, bypass, redirect blocking, offline startup, state relocation, concurrent launch, archive traversal, runtime tampering, and release signature rejection. The `-RequireStandardUser` switch fails if run elevated. CI builds and tests on Windows and uploads artifacts; a tag matching version.json publishes tested artifacts. No release or signing identity is assumed to exist.

See [docs/BUILDING.md](docs/BUILDING.md) for build provenance and [CHANGELOG.md](CHANGELOG.md) for changes. Windows x64 is the only implemented target in this repository.
