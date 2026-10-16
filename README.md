# Pi Response — AI-Assisted Incident Response & Cyber Triage

<img src="assets/pi-response.svg" width="88" height="88" alt="Pi Response shield icon">

**The Pi coding agent, packaged as a portable asset for Incident Response.**

[![Windows and Linux builds](https://github.com/ricanwarfare/pi-response/actions/workflows/windows.yml/badge.svg)](https://github.com/ricanwarfare/pi-response/actions/workflows/windows.yml)
[![Latest release](https://img.shields.io/github/v/release/ricanwarfare/pi-response)](https://github.com/ricanwarfare/pi-response/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Pi Response is an **Incident Response distribution fork of the [Pi coding agent](https://github.com/earendil-works/pi)** by Mario Zechner and the Pi contributors. Carry one Windows or Linux executable onto a system, connect to your model provider, and use Pi to inspect processes, examine logs, and work through an investigation from the terminal.

This repository maintains the portable launchers, provider presets, tests, and release tooling. It packages **unmodified official Pi binaries** rather than modifying Pi's agent source. It is an independent project, not an official Pi release.

[**Download Windows / Linux x64**](https://github.com/ricanwarfare/pi-response/releases/latest) · [Windows quick start](#windows-quick-start) · [Linux quick start](#linux-quick-start) · [Build from source](docs/BUILDING.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

Previously named **Pi Portable**. Version 0.6.0 starts fresh under `pi-response-data`; releases before v0.6.0 retain their original filenames.

## Why Pi Response?

- **One file per platform.** Carry `pi-response.exe` for Windows or `pi-response-linux-x64` for Linux; each embeds its runtime and assets.
- **No development tools on the target.** No Node.js, Bun, npm, Git Bash, or local Ollama installation required.
- **PowerShell for Windows investigations.** Inspect the host using its native shell alongside Pi's file-reading and search tools.
- **Bash on Linux.** A native Linux x64 launcher provides the same portable storage and Ollama setup, with Bash as the shell tool.
- **Search utilities included.** Bundled ripgrep and fd work without target-side downloads.
- **IR case workflow.** Collect bounded snapshots without a model call, transfer verified evidence, and export reports with checked source citations.
- **Optional web research.** Bundled pi-web-search uses your Ollama Cloud key; enable it explicitly with `/web on`.
- **Portable case data.** Configuration, sessions, and child-process temporary files default to a folder beside the executable, or a location you choose.
- **Ollama Cloud preconfigured.** DeepSeek 4.1 Flash is selected by default; supply your own API key.
- **Less automatic loading from the host.** Normal agent launches disable workspace instruction/extension discovery, project approval, MCP, startup downloads, and telemetry.

**One file to distribute does not mean one file while running.** The launcher extracts and verifies its embedded runtime before starting Pi. It is not a memory-only executable.

## Downloads

Use the [latest GitHub Release](https://github.com/ricanwarfare/pi-response/releases/latest) for ready-to-run binaries:

| Platform | Executable | Checksum |
| --- | --- | --- |
| Windows x64 | [pi-response.exe](https://github.com/ricanwarfare/pi-response/releases/latest/download/pi-response.exe) | [SHA256](https://github.com/ricanwarfare/pi-response/releases/latest/download/pi-response.exe.sha256) |
| Linux x64 | [pi-response-linux-x64](https://github.com/ricanwarfare/pi-response/releases/latest/download/pi-response-linux-x64) | [SHA256](https://github.com/ricanwarfare/pi-response/releases/latest/download/pi-response-linux-x64.sha256) |

Copy **only the executable for your platform** to your USB drive or support host. You do not need the entire `dist` folder, a separate icon, or a source-code ZIP. Keep the checksum file to verify the transfer. The optional `.build.json` file records the source commit, dependency pins, and hashes; it is not needed to run Pi.

The repository contains source and build tools. Generated binaries are published in Releases and excluded from Git. If you clone the repository, [build the executable](docs/BUILDING.md) before running it.

## Windows quick start

### 1. Download and verify

Download `pi-response.exe` and `pi-response.exe.sha256` from the [latest release](https://github.com/ricanwarfare/pi-response/releases/latest). Place them on a response drive or in a writable tools folder, then verify the executable:

```powershell
$expected = (Get-Content .\pi-response.exe.sha256 -Raw).Split(' ')[0].Trim()
$actual = (Get-FileHash .\pi-response.exe -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Checksum mismatch' }
```

The current EXE is **unsigned**; signing support is prepared but no signing account is configured. A matching SHA256 confirms the file matches the published checksum; it is not a code signature. See [Windows signing status and setup](docs/CODE_SIGNING.md).

### 2. Enter your key and choose storage

Create a key in [Ollama API key settings](https://ollama.com/settings/keys). **Double-click `pi-response.exe` in File Explorer**, or launch it from PowerShell:

```powershell
.\pi-response.exe
```

It opens a console, asks for your key and storage choice if needed, and starts Pi. This remains a terminal application. With double-click launch, the working directory will normally be the EXE's folder. To investigate another directory, use PowerShell as shown below or set a shortcut's **Start in** folder.

The preset connects directly to `https://ollama.com/v1` using model ID `deepseek-v4.1-flash`. No model download or local Ollama service is needed. Internet access and model access on your account are required. See [Ollama's model page](https://ollama.com/library/deepseek-v4.1-flash) and [API documentation](https://docs.ollama.com/api/openai-compatibility).

On the first interactive launch, paste your API key into the hidden-input prompt and press Enter, then choose:

- **1 or Enter — session only (default):** pass the key to Pi for this launch without saving a launcher key file.
- **2 — save on this drive:** save it at `pi-response-data/agent/ollama-cloud.key` for future launches.

Escape or Ctrl+C cancels either prompt without changing a saved key. Pi starts after the choice. Normal launches continue to reuse an existing saved key.

**The saved key is plaintext so the USB works across systems.** Protect the drive and do not share its data folder. The key is never embedded in the public EXE, echoed by the prompt, or placed in Pi's command-line arguments. Pi's own stored credentials, if configured through `/login`, take precedence.

Run `.\pi-response.exe --response-setup` to enter a key and choose storage again. To explicitly prompt for a temporary key, ignoring the launcher-saved key and inherited `OLLAMA_API_KEY` for this launch, use `.\pi-response.exe --response-session-key`. This leaves an existing saved key unchanged; it does not delete it. You can also supply a process key by setting `$env:OLLAMA_API_KEY = '<your-key>'` before launch. Redirected input/output and RPC do not trigger automatic setup or consume piped prompts; use a saved key or the environment for automation. Resumed sessions defer authentication to Pi.

Session-only applies to launcher key storage, not the whole application. Configuration, cases, sessions, and temporary files can still be written. The key remains in the running process environment and can be read by a sufficiently privileged process. Pi's own `/login` credentials can still take precedence; use a fresh data folder if you need a clean credential context. Avoid putting keys in prompts, scripts, shell history, or command-line arguments.

### 3. Start an investigation

Launch from the directory you want to work in:

```powershell
Set-Location 'C:\CollectedEvidence'
E:\Tools\pi-response.exe
```

Or process a single prompt and exit:

```powershell
E:\Tools\pi-response.exe -p 'Use PowerShell to list running processes, their paths, and parent process IDs. Summarize entries that warrant investigation.'
```

Validate findings against the original evidence. Model conclusions are not a substitute for evidence preservation or analyst judgment.

## Linux quick start

Download `pi-response-linux-x64` and its `.sha256` file from the [latest release](https://github.com/ricanwarfare/pi-response/releases/latest). Put the executable on your response drive or transfer it to a support host:

```bash
sha256sum -c pi-response-linux-x64.sha256
chmod +x pi-response-linux-x64
./pi-response-linux-x64
```

On the first interactive run, enter your Ollama Cloud API key at the hidden prompt, then choose **1 or Enter for session only** or **2 to save on this drive**. Saved keys are plaintext at `pi-response-data/agent/ollama-cloud.key` and are reused later. Use `--response-setup` to choose again, or `--response-session-key` to enter a temporary key without reading or replacing the launcher-saved key. On ordinary launches an existing `OLLAMA_API_KEY` environment variable overrides the launcher-saved key.

The Linux build uses `read,bash,grep,find,ls` by default. It includes Pi, ripgrep, and fd; **no Go, Node.js, Bun, Python, or local Ollama installation is required on the target**. Bash and a compatible glibc-based Linux system are required. CI validates Ubuntu 22.04 and 24.04 x64. Alpine/musl, ARM64, older distributions, and GUI double-click launch are not validated targets.

```bash
# Keep the executable and case data on an executable, writable filesystem.
export PI_RESPONSE_HOME='/home/analyst/ir/case-042/pi-data'
/media/usb/pi-response-linux-x64

# One support task; shell commands can change the remote host.
./pi-response-linux-x64 -p 'Use Bash to list listening TCP ports and identify their processes.'
```

Linux files must be launched from a terminal or SSH session. The executable and extracted runtime must be on filesystems that allow execution (`noexec` mounts block them). Newly created data directories request mode `0700`, and saved keys/configuration request `0600`; filesystem support and mount options determine enforcement. FAT/exFAT USB storage may not enforce owner-only permissions. Protect the drive.

For interactive remote support, request a terminal with `ssh -t analyst@host './pi-response-linux-x64'` after transferring the executable to that account's home directory. If you choose to save the key, it and the sessions then live on the remote host beside the executable, unless you choose another `PI_RESPONSE_HOME`. Session-only avoids writing the launcher key file; sessions and cases can still persist.

Windows and Linux can share a portable data folder, including the saved key and model settings; each platform has its own extracted runtime hash. Use host-appropriate shell commands and review any custom settings carried between systems.

## Investigation examples

Examples assume the executable is on your PATH. Otherwise use `.\pi-response.exe` on Windows, `./pi-response-linux-x64` on Linux, or the full path.

| Task | Windows | Linux |
| --- | --- | --- |
| Review logs without a shell | `pi-response.exe --tools read,grep,find,ls -p 'Review these logs for authentication anomalies. Cite source files and lines.'` | `pi-response-linux-x64 --tools read,grep,find,ls -p 'Review these logs for authentication anomalies. Cite source files and lines.'` |
| Name a case session | `pi-response.exe --name 'Case-042 host-01'` | `pi-response-linux-x64 --name 'Case-042 host-01'` |
| Resume the previous session | `pi-response.exe --continue` | `pi-response-linux-x64 --continue` |
| Inspect paths and wrapper version | `pi-response.exe --response-info` | `pi-response-linux-x64 --response-info` |
| Show upstream Pi version | `pi-response.exe --version` | `pi-response-linux-x64 --version` |
| Enter a key and choose storage | `pi-response.exe --response-setup` | `pi-response-linux-x64 --response-setup` |
| Enter a temporary key for this launch | `pi-response.exe --response-session-key` | `pi-response-linux-x64 --response-session-key` |

Search respects ignore rules such as `.gitignore`; it is not exhaustive forensic enumeration.

### Choose your tools

| Platform | Default tools |
| --- | --- |
| Windows | `read,powershell,grep,find,ls` |
| Linux | `read,bash,grep,find,ls` |

PowerShell and Bash can modify the host. To work without a shell or dedicated editing tools, use `--tools read,grep,find,ls` with either executable. On Windows:

```powershell
.\pi-response.exe --tools read,grep,find,ls
```

To enable editing on Windows:

```powershell
.\pi-response.exe --tools read,powershell,edit,write,grep,find,ls
```

An explicit `--tools` list replaces the portable default. Pi also accepts `--no-tools` and `--exclude-tools`. Tool selection is not an operating-system security boundary.

On Linux, use `--tools read,bash,edit,write,grep,find,ls` to enable the equivalent shell and editing tools.

## Incident response workflow

Collect locally without an API key or model request:

```powershell
.\pi-response.exe --response-triage
```

```bash
./pi-response-linux-x64 --response-triage
```

The command prints a new case folder under `pi-response-data/cases/`, with host/operator metadata, six groups of raw evidence, exact collector commands and UTC timestamps, a collection report, and SHA-256 manifests. Collectors have time/output limits and record permission failures and truncation.

Copy the whole case folder to your workstation, start Pi in a fresh session, and use:

```text
/case <path-to-case-folder>
/analyze
/report
```

`/analyze` asks before sending case material to the selected provider and selects inspection tools. `/report` exports Markdown/JSON findings with observations, hypotheses, confidence, unanswered questions, and evidence citations. Export checks artifact hashes and source line ranges; it does not verify the model's interpretation. Analyst review is required.

Inside Pi, `/triage [label]` collects all groups. `/host`, `/processes`, `/network`, `/persistence`, `/logons`, and `/timeline` collect individual groups into new cases. See the [IR workflow and collection limits](docs/INCIDENT_RESPONSE.md) for details. Live collection leaves a footprint and is not a forensic image or a guarantee that a host is clean.

## Web research

Both executables bundle [pi-web-search 1.7.0](https://github.com/ttttmr/pi-web-search). Web tools are **off by default**. Inside Pi:

```text
/web on
Search the web for Microsoft's documentation on Windows event 4624. Cite the source URLs.
/web off
```

`/web on` asks you to confirm that queries and supplied URLs will go to your search provider and may incur charges. With the default Ollama Cloud preset, `web_search` and `url_context` use Ollama's search/fetch APIs and the same key as chat, whether session-only or saved. No separate search key, npm, local Ollama daemon, or target-side installation is required. Use `/web status` to check the current state.

Access resets when starting/resuming a session, collecting any triage group, or running `/analyze`. `/web off` cancels active web requests. Case analysis remains limited to existing evidence; finish it before enabling web research separately. These controls apply to the bundled web tools; PowerShell/Bash can still use the network.

Use public research terms. Do not submit raw logs, credentials, internal hostnames, or private case identifiers. Retrieved pages are untrusted sources, and web claims should be distinguished from collected host evidence. Results and source URLs appear in the conversation and are retained when session persistence is enabled; they are not automatically added to a case evidence manifest.

An explicit `--tools` allowlist must include `web_search,url_context` if you want `/web on` to enable them. For example, `--tools read,grep,find,ls,web_search,url_context` permits inspection and optional research. `--no-tools` or `--exclude-tools` restrictions are respected. A dialog-capable interactive or RPC session is required to enable access.

The package supports other provider-native search APIs and an optional `agent/web-search.json` override for a dedicated search model. URL retrieval is available for Ollama Cloud and Gemini; support depends on the selected provider. See the [upstream package documentation](vendor/pi-web-search/README.md). Automated tests use fake Ollama endpoints; live account access and other provider integrations require separate validation.

## How it works

```text
platform executable
  ├─ verifies and extracts the embedded Pi distribution
  ├─ creates the Ollama preset if configuration files are absent
  ├─ redirects Pi state and child temporary files to the portable home
  └─ starts Pi with the current working directory and console
       ├─ PowerShell or Bash / file and search tools → investigated system
       └─ model requests → Ollama Cloud
```

Each executable contains Pi's runtime, assets, native helpers, ripgrep, and fd. Later launches verify the cached runtime against the embedded archive. Concurrent launches serialize extraction; changed or incomplete expected runtime files, unexpected files, and runtime symlinks/junctions cause startup to stop. Keep custom files and tools outside the extracted runtime directory.

Arguments, piped input, working directory, and Pi's exit code are preserved. Interactive, print, JSON, and RPC modes remain available. `--response-notices` prints the embedded upstream license notice.

### Where data lives

```text
response-drive/
├── pi-response.exe           Windows executable (optional if using Linux only)
├── pi-response-linux-x64     Linux executable (optional if using Windows only)
└── pi-response-data/
    ├── runtime/<payload-sha256>/  Platform-specific distribution and licenses
    ├── agent/                    settings.json, models.json, saved key, Pi auth/state
    ├── sessions/                 Conversations grouped by working directory
    ├── cases/<case-id>/           Evidence, collector audit, manifests, reports
    ├── tmp/                      Child-process temporary files
    └── runtime.lock              Extraction/configuration lock
```

To store case data elsewhere or run the executable from read-only media, set `PI_RESPONSE_HOME`. On Windows:

```powershell
$env:PI_RESPONSE_HOME = 'E:\IR\Case-042\pi-data'
D:\Tools\pi-response.exe
```

Use an absolute path. Move the data folder too if you need the same sessions and credentials elsewhere. Treat it as sensitive case material: the wrapper does not encrypt credentials, conversations, or tool results.

The launcher overrides inherited Pi agent, session, and package paths. Explicit Pi arguments such as `--session-dir` can still direct output elsewhere.

### Model configuration

First launch creates `agent/models.json` and `agent/settings.json` from the embedded [model preset](config/models.json) and [settings preset](config/settings.json). Existing files are never overwritten.

Edit the portable copies to change the endpoint or model. Explicit `--provider` and `--model` arguments override saved defaults. The Ollama preset references `${OLLAMA_API_KEY}` at request time and caps configured output at 8,192 tokens per response.

Changing providers does not require rebuilding the executable. For a built-in provider, supply its credentials and select it with `--provider` and `--model`, or use Pi's `/login` and `/model` commands. Set `defaultProvider` and `defaultModel` in the portable `agent/settings.json` to save your choice.

For a local/private endpoint, add it to the portable `agent/models.json` following [Pi's compatible-endpoint configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#configure-a-compatible-endpoint). No model weights are included.

## Incident Response boundaries

- **Cloud evidence handling:** prompts and included tool results go to the selected provider, Ollama Cloud by default. Use an endpoint approved for your evidence-handling requirements.
- **Host changes:** Pi runs with the launching account's permissions. PowerShell, Bash, and enabled integrations can modify the host. This is not a sandbox, forensic write blocker, or zero-artifact tool.
- **Host trust:** integrity checks detect changed expected runtime files. They cannot establish trust in a compromised host or stop a privileged attacker changing files after verification.
- **Automatic discovery:** normal launches disable project approval, AGENTS.md/CLAUDE.md discovery, extension/skill discovery, prompt templates, custom themes, and MCP. The bundled IR and web adapters are loaded explicitly; additional explicit extension/skill paths can still load code or instructions.
- **Network behavior:** startup network operations and telemetry are disabled. Inference and explicitly invoked commands can still use the network. Pi's `--offline` flag does not make cloud inference work offline.
- **Subcommands:** upstream commands such as `auth`, `install`, and `update` run directly with the portable environment; normal agent-launch flags are not prepended.

## Compatibility and release status

| Component | Current target |
| --- | --- |
| Platforms | Windows x64; Linux x64 (Ubuntu 22.04/24.04 CI) |
| Windows prerequisites | .NET Framework 4.8 and Windows PowerShell |
| Linux prerequisites | Bash, compatible glibc Linux, executable filesystem |
| Upstream Pi | 1.3.0 |
| Search tools | ripgrep 15.2.0, fd 10.5.0 |
| Default connection | Ollama Cloud / DeepSeek 4.1 Flash |
| Wrapper | 0.7.0 — session-only key choice; optional signing pipeline prepared |

Automated tests cover both launchers and actual tools using a local fake model, including default model selection and saved-key Bearer authentication. Linux tests also exercise a real pseudo-terminal for hidden input, replacement, and cancellation. No real provider account is used. Live Ollama account access and broader interactive TUI behavior still need validation. ARM64, macOS, and older operating systems are not validated targets.

## Build, update, and contribute

For a Windows build:

```powershell
git clone https://github.com/ricanwarfare/pi-response.git
Set-Location pi-response
pwsh -NoProfile -File .\scripts\build.ps1
node --test .\tests\launcher.test.mjs
node --test .\tests\signing.test.mjs
node --test .\tests\triage.test.mjs
node --test .\tests\web.test.mjs
node .\tests\web-runtime.mjs
node .\tests\triage-runtime.mjs
node .\tests\triage-analysis-smoke.mjs
node .\tests\runtime-smoke.mjs
```

Windows builds require PowerShell 7 and the .NET Framework C# compiler; tests also need Node.js 22+. A .NET SDK is not required.

For a Linux build, clone the repository and run:

```bash
python3 scripts/build-linux.py
cd src/linux && go test -v ./... && go vet ./...
cd ../..
python3 tests/linux-launcher.py
node --test tests/triage.test.mjs
node --test tests/web.test.mjs
node tests/web-runtime.mjs
node tests/triage-runtime.mjs
node tests/triage-analysis-smoke.mjs
node tests/runtime-smoke.mjs
```

Linux builds use Go 1.27.2 and Python 3; tests also need Node.js 22+. Neither platform needs a checkout of upstream Pi or npm dependencies. Both builds download checksum-pinned official archives, with cached archives available for subsequent offline builds.

See [building and release instructions](docs/BUILDING.md), [contributing](CONTRIBUTING.md), and the [changelog](CHANGELOG.md). The [Windows and Linux workflow](.github/workflows/windows.yml) builds and tests both platforms before publication.

The [upstream update check](.github/workflows/upstream-update.yml) runs daily and proposes verified Pi release pins in a draft PR, then explicitly starts Windows/Linux validation. Existing customizations and other dependency pins are preserved. Merging and publishing remain manual; see [update automation](docs/BUILDING.md#automated-pi-update-proposals).

Update by downloading a new release, verifying its checksum, and placing it beside your existing `pi-response-data` folder. Existing configuration is preserved; a new release does not overwrite your provider/model choices. The rename from Pi Portable starts fresh as described above. **Do not use `pi update self` to update the wrapper**: changing the extracted runtime can make its next integrity check fail. See [troubleshooting](docs/TROUBLESHOOTING.md) for recovery.

Upstream Pi updates are currently reviewed and applied through the pinned Windows and Linux manifests, followed by builds and tests. Deployed copies do not automatically replace their runtime.

### Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Windows launcher and native Linux launcher |
| `scripts/` | Build, icon-generation, and changelog-to-release-note tooling |
| `config/` | Embedded provider and settings templates |
| `tests/` | Launcher integration tests and fake-model runtime smoke test |
| `assets/` | Original icon artwork and required license files |
| `docs/` | Maintained build and troubleshooting guides |
| `upstream*.json`, `version.json` | Pinned dependency releases and wrapper version |

Generated distributions (`dist/`), caches (`.build/`), prepared Linux bundles, reference checkouts, credentials, and sessions are excluded by [`.gitignore`](.gitignore). Release history is maintained in [`CHANGELOG.md`](CHANGELOG.md); GitHub release notes are generated from it. Published binaries, checksums, and manifests live in [GitHub Releases](https://github.com/ricanwarfare/pi-response/releases).

## Attribution and license

Pi Response is a fork of the Pi coding agent for use as a portable asset in Incident Response. The current implementation is a distribution fork: original launcher and packaging code around unmodified upstream release binaries. Development of the agent itself belongs to [earendil-works/pi](https://github.com/earendil-works/pi).

Launcher code is available under the [MIT License](LICENSE). Pi's copyright and MIT notice are retained in [NOTICE.txt](NOTICE.txt). Dependencies retain their original licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and the extracted distribution. This project is not affiliated with or endorsed by Pi, Ollama, or DeepSeek.
