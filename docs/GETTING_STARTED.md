# Build, configure and use Pi Portable

**Prefer clicking?** Double-click the EXE to set up your provider, model, key and project in a Windows settings window. Enable Web access and Delegation there to remember those choices. Inside the agent, type `/portable` to change them; saving automatically restarts and continues the project session. See [APP_SETTINGS.md](APP_SETTINGS.md) for encrypted key storage and its portability limits. The command-line steps below remain supported.

## 1. Get the executable

Target machines need Windows x64, .NET Framework 4.8, a writable state folder and permission to run the executable and its extracted child tools. They do not need administrator rights, Node.js, npm, Git or an installed Pi. The `full` profile uses Windows PowerShell. The EXE is unsigned unless your organization configures signing; AppLocker, WDAC, SmartScreen or other enterprise rules can still block it. The application does not change those rules.

Use the built `dist/pi-portable.exe`, or download the `pi-portable-windows-x64` artifact from a successful run under the repository's **Actions → Windows build and release**. The artifact includes the EXE, checksum and build manifest. Extract the artifact ZIP before running. Tagged releases, when published, provide the same files under **Releases**.

To build it yourself on a Windows development machine, install or obtain approved .NET Framework 4.8, PowerShell 7, Node.js 22+ and Git with OpenSSL. Run these commands in a non-elevated PowerShell 7 terminal:

```powershell
git clone https://github.com/ricanwarfare/pi-portable.git
Set-Location pi-portable
.\scripts\build.ps1
.\scripts\test.ps1 -RequireStandardUser
```

The private repository requires your GitHub access. The first build downloads checksum-pinned archives. Cached builds work offline. Ordinary builds need no npm installation; the extension bundles are committed. Output is `dist\pi-portable.exe`, `dist\pi-portable.exe.sha256` and `dist\pi-portable.exe.build.json`. See [BUILDING.md](BUILDING.md) for provenance and bundle regeneration.

Copy the EXE and checksum into your chosen folder, for example `E:\Tools`. Verify its bytes there:

```powershell
Set-Location E:\Tools
$expected = (Get-Content .\pi-portable.exe.sha256 -Raw).Split(' ')[0]
if ((Get-FileHash .\pi-portable.exe -Algorithm SHA256).Hash -ne $expected) {
    throw 'Checksum mismatch'
}
```

## 2. Create your configuration

```powershell
.\pi-portable.exe --configure
notepad .\pi-portable-data\portable.json
```

This creates a starter file without contacting a service. If it already exists, edit it directly; `--configure` refuses to overwrite it. Default state lives beside the EXE. If that location is read-only, use the user profile consistently for configuration and subsequent launches:

```powershell
.\pi-portable.exe --portable-storage user --configure
notepad "$env:LOCALAPPDATA\PiPortable\portable.json"
.\pi-portable.exe --portable-storage user --project C:\Projects\MyApp
```

You can instead use `--portable-home E:\PiState` for a chosen state folder, or `--portable-config E:\Tools\my-provider.json` to select a separate configuration file. `--portable-info` prints the selected paths without making a model request. Keep using the same storage flags to retain your settings and sessions.

## 3. Configure a custom provider

Get the **API base URL**, exact **model ID**, supported **API format** and **authentication method** from your internal service owner. There is no automatic model discovery. Your service needs the compatible streaming API and tool calling for coding-agent tool use. A custom proprietary protocol requires a compatible gateway.

For a custom Chat Completions service with a Bearer key, replace the starter file with this JSON and edit the URL/model:

```json
{
  "kind": "custom",
  "baseUrl": "https://gateway.internal.example/api/v1",
  "model": "company-coder",
  "api": "openai-completions",
  "auth": "bearer",
  "keyEnv": "PI_PORTABLE_API_KEY",
  "profile": "review",
  "proxy": "env",
  "contextWindow": 32768,
  "maxTokens": 4096
}
```

The wrapper appends `/chat/completions`, so this example sends requests to `https://gateway.internal.example/api/v1/chat/completions`. Do not put the final `/chat/completions` path in `baseUrl`. Preserve whatever base prefix your service requires, including `/v1` when applicable. The `api` value `openai-completions` selects Chat Completions; it does not select the old text-completions endpoint. [Copyable example](../config/custom-chat.example.json).

For the Responses API, use `"api": "openai-responses"`; the wrapper appends `/responses`. For a normal OpenAI-compatible service, `"kind": "openai"` also works. All configured services use the internal Pi provider name `portable`; configure them here instead of passing upstream `--provider`/`--model` flags, editing Pi's generated files or using `/login`.

Choose authentication as follows:

| Service expects | Configuration |
| --- | --- |
| `Authorization: Bearer KEY` | `"auth": "bearer"` |
| `api-key: KEY` | `"auth": "api-key"` |
| No authentication | `"auth": "none"` |
| Custom header such as `X-Company-Token` | `"auth": "none", "headers": { "X-Company-Token": "${COMPANY_TOKEN}" }` |

With Bearer/API-key authentication, a launch first uses the configured environment variable, then an explicitly remembered DPAPI key. If neither exists, an interactive launch prompts for a hidden session-only key; that terminal prompt does not save it. `--session-key` forces a new prompt without replacing a saved key. For automated or redirected launches, inject `PI_PORTABLE_API_KEY` through your approved secret mechanism or use a key already saved by the same Windows user; there is no interactive prompt for redirected input.

For a custom header, the placeholder in JSON stays literal and its environment variable must exist before launch. The launcher does not prompt for custom-header values. This Windows PowerShell-compatible example reads one without putting the value into command history, then clears this process's variable when Pi exits:

```powershell
$secret = Read-Host 'Company token' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $env:COMPANY_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secret.Dispose()
}
try {
    E:\Tools\pi-portable.exe --project C:\Projects\MyApp
} finally {
    Remove-Item Env:COMPANY_TOKEN -ErrorAction SilentlyContinue
}
```

Environment values are available to the running process and its children; clearing a variable is not secure memory erasure. Keep secrets out of JSON, prompts, tool commands and source control. [Custom-header Responses example](../config/custom.example.json).

For internal HTTPS, add `"caFile": "company-ca.pem"` and place your approved PEM CA bundle beside `portable.json`. Relative CA paths resolve against the configuration file. Omit that field if the runtime already trusts the service. TLS verification remains enabled. For routing, `"proxy": "env"` uses process proxy variables, `"proxy": "direct"` ignores them, and an explicit proxy origin such as `"proxy": "http://proxy.internal.example:8080"` selects your proxy. Do not assume Windows integrated proxy authentication or the Windows-only certificate store is supported. See [CONFIGURATION.md](CONFIGURATION.md) for limits and [Ollama](../config/ollama.example.json)/[Azure](../config/azure.example.json) examples.

## 4. Start coding

First make a small authenticated model request. This does contact the configured service:

```powershell
E:\Tools\pi-portable.exe --project C:\Projects\MyApp --print 'Reply with READY.'
```

Then use the interactive agent, or ask for a one-off task:

```powershell
# Read and search only (the default).
E:\Tools\pi-portable.exe --project C:\Projects\MyApp

# Permit file edits.
E:\Tools\pi-portable.exe --project C:\Projects\MyApp --profile edit

# Also permit native PowerShell, for example to run project tests.
E:\Tools\pi-portable.exe --project C:\Projects\MyApp --profile full

# One-off coding request, then exit.
E:\Tools\pi-portable.exe --project C:\Projects\MyApp --profile edit --print 'Fix the parser and explain the changes.'

# Continue the most recent session for this project.
E:\Tools\pi-portable.exe --project C:\Projects\MyApp --continue
```

Tool profiles apply to the model's tools; they are not an operating-system sandbox. Review generated changes using your usual source-control workflow. Sessions belong to the detected Git project root, or the explicit directory when there is no Git root. To move your portable setup, carry both the EXE and `pi-portable-data`; moving projects requires the session-fork steps in [README](../README.md#state-projects-and-tools).

## 5. Optional subagents and web access

```powershell
E:\Tools\pi-portable.exe --project C:\Projects\MyApp --profile edit --subagents
E:\Tools\pi-portable.exe --project C:\Projects\MyApp --profile edit --subagents --web
```

Example request: “Have the reviewer inspect the parser and the oracle inspect the tests in parallel, then summarize their findings.” Foreground single agents, flat parallel batches and sequential chains are supported. Children use your configured model and profile. Detached runners, arbitrary workflow scripts and external CLI agents are disabled. See [SUBAGENTS.md](SUBAGENTS.md).

Web access stays off unless enabled. `--web` exposes `web_search` and `fetch_content`; public Exa/Brave search requires external connectivity unless compatible internal mirrors are configured. Model API credentials are separate from search credentials. For an environment with no public egress, keep web off or configure approved internal mirrors and allowlists in [WEB_ACCESS.md](WEB_ACCESS.md). No startup download is needed for either extension.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing endpoint/model | Edit the selected `portable.json`; use `--portable-info` to confirm the paths. |
| 401 / 403 | Confirm the auth mode, session key, custom header and your service permissions. |
| 404 | Confirm the base prefix/API format and model/deployment ID; do not double the appended API route. |
| Certificate failure | Supply the approved PEM CA chain; check the hostname. Do not disable verification. |
| Connection/proxy failure | Confirm network reachability and the configured proxy mode; PAC/NTLM/Kerberos are not implemented. |
| Chat works but tools fail | Confirm the model/service supports the tool-call format and selected profile; adjust compatible service settings with its owner. |
| “Configuration already exists” | Edit the existing file instead of rerunning `--configure`. |
| EXE, child tool or script blocked | Ask IT for an approved execution/signing policy. No-admin packaging does not override enterprise controls. |

The complete supported options are in [CONFIGURATION.md](CONFIGURATION.md). Upstream `--help` also lists options deliberately unavailable through this wrapper.
