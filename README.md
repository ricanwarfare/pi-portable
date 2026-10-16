# Pi Portable

<img src="assets/pi-portable.svg" width="88" height="88" alt="Pi Portable shield icon">

**The Pi coding agent, packaged as a portable asset for Incident Response.**

[![Windows and Linux builds](https://github.com/ricanwarfare/pi-portable/actions/workflows/windows.yml/badge.svg)](https://github.com/ricanwarfare/pi-portable/actions/workflows/windows.yml)
[![Latest release](https://img.shields.io/github/v/release/ricanwarfare/pi-portable)](https://github.com/ricanwarfare/pi-portable/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Pi Portable is an **Incident Response distribution fork of the [Pi coding agent](https://github.com/earendil-works/pi)** by Mario Zechner and the Pi contributors. Carry one Windows or Linux executable onto a system, connect to your model provider, and use Pi to inspect processes, examine logs, and work through an investigation from the terminal.

This repository maintains the portable launchers, provider presets, tests, and release tooling. It packages **unmodified official Pi binaries** rather than modifying Pi's agent source. It is an independent project, not an official Pi release.

[**Download Windows / Linux x64**](https://github.com/ricanwarfare/pi-portable/releases/latest) · [Windows quick start](#quick-start) · [Linux quick start](#linux) · [Build from source](docs/BUILDING.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

## Why Pi Portable?

- **One file to carry.** Distribute `pi-portable.exe`; the runtime and assets are embedded.
- **No development tools on the target.** No Node.js, Bun, npm, Git Bash, or local Ollama installation required.
- **PowerShell for Windows investigations.** Inspect the host using its native shell alongside Pi's file-reading and search tools.
- **Bash on Linux.** A native Linux x64 launcher provides the same portable storage and Ollama setup, with Bash as the shell tool.
- **Search utilities included.** Bundled ripgrep and fd work without target-side downloads.
- **Portable case data.** Configuration, sessions, and child-process temporary files default to a folder beside the EXE, or a location you choose.
- **Ollama Cloud preconfigured.** DeepSeek 4.1 Flash is selected by default; supply your own API key.
- **Less automatic loading from the host.** Normal agent launches disable workspace instruction/extension discovery, project approval, MCP, startup downloads, and telemetry.

**One file to distribute does not mean one file while running.** The launcher extracts and verifies its embedded runtime before starting Pi. It is not a memory-only executable.

## Quick start

### 1. Download and verify

Download `pi-portable.exe` and `pi-portable.exe.sha256` from the [latest release](https://github.com/ricanwarfare/pi-portable/releases/latest). Place them on a response drive or in a writable tools folder, then verify the executable:

```powershell
$expected = (Get-Content .\pi-portable.exe.sha256 -Raw).Split(' ')[0].Trim()
$actual = (Get-FileHash .\pi-portable.exe -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Checksum mismatch' }
```

The EXE is currently **unsigned**. A matching SHA256 confirms the file matches the published checksum; it is not a code signature.

### 2. Enter your Ollama Cloud key once

Create a key in [Ollama API key settings](https://ollama.com/settings/keys), then launch the EXE:

You can **double-click `pi-portable.exe` in File Explorer**. It opens a console, asks for your key if needed, and starts Pi. This remains a terminal application; its working directory will normally be the EXE's folder. To investigate a particular directory, launch it from PowerShell as shown below, or set a shortcut's **Start in** folder.

```powershell
.\pi-portable.exe
```

The preset connects directly to `https://ollama.com/v1` using model ID `deepseek-v4.1-flash`. No model download or local Ollama service is needed. Internet access and model access on your account are required. See [Ollama's model page](https://ollama.com/library/deepseek-v4.1-flash) and [API documentation](https://docs.ollama.com/api/openai-compatibility).

On the first interactive launch, paste your API key into the hidden-input prompt and press Enter. Pi starts immediately afterward. Future launches reuse the key saved at `pi-portable-data/agent/ollama-cloud.key`. Escape or Ctrl+C cancels without saving.

**The saved key is plaintext so the USB works across systems.** Protect the drive and do not share its data folder. The key is never embedded in the public EXE, echoed by the prompt, or placed in Pi's command-line arguments. Pi's own stored credentials, if configured through `/login`, take precedence.

To replace the launcher-saved key, run `.\pi-portable.exe --portable-setup`. To avoid saving a key or to override the saved value for one process, set `$env:OLLAMA_API_KEY = '<your-key>'` before launch. Redirected input/output and RPC do not trigger automatic setup or consume piped prompts; use a saved key or the environment for automation. Resumed sessions defer authentication to Pi.

### 3. Start an investigation

Launch from the directory you want to work in:

```powershell
Set-Location 'C:\CollectedEvidence'
E:\Tools\pi-portable.exe
```

Or process a single prompt and exit:

```powershell
E:\Tools\pi-portable.exe -p 'Use PowerShell to list running processes, their paths, and parent process IDs. Summarize entries that warrant investigation.'
```

Validate findings against the original evidence. Model conclusions are not a substitute for evidence preservation or analyst judgment.

## Linux

Download `pi-portable-linux-x64` and its `.sha256` file from the [latest release](https://github.com/ricanwarfare/pi-portable/releases/latest). Put the executable on your response drive or transfer it to a support host:

```bash
sha256sum -c pi-portable-linux-x64.sha256
chmod +x pi-portable-linux-x64
./pi-portable-linux-x64
```

On the first interactive run, enter your Ollama Cloud API key at the hidden prompt. It is saved in plaintext at `pi-portable-data/agent/ollama-cloud.key`, beside the executable's location, and reused later. Use `--portable-setup` to replace it. An existing `OLLAMA_API_KEY` environment variable overrides the launcher-saved key.

The Linux build uses `read,bash,grep,find,ls` by default. It includes Pi, ripgrep, and fd; **no Go, Node.js, Bun, Python, or local Ollama installation is required on the target**. Bash and a compatible glibc-based Linux system are required. CI validates Ubuntu 22.04 and 24.04 x64. Alpine/musl, ARM64, older distributions, and GUI double-click launch are not validated targets.

```bash
# Keep the executable and case data on an executable, writable filesystem.
export PI_PORTABLE_HOME='/home/analyst/ir/case-042/pi-data'
/media/usb/pi-portable-linux-x64

# One support task; shell commands can change the remote host.
./pi-portable-linux-x64 -p 'Use Bash to list listening TCP ports and identify their processes.'
```

Linux files must be launched from a terminal or SSH session. The executable and extracted runtime must be on filesystems that allow execution (`noexec` mounts block them). Newly created data directories request mode `0700`, and saved keys/configuration request `0600`; filesystem support and mount options determine enforcement. FAT/exFAT USB storage may not enforce owner-only permissions. Protect the drive.

Windows and Linux can share a portable data folder, including the saved key and model settings; each platform has its own extracted runtime hash. Use host-appropriate shell commands and review any custom settings carried between systems.

## Investigation examples

Examples assume the EXE is on your PATH; otherwise use `.\pi-portable.exe` or its full path.

| Task | Command |
| --- | --- |
| Review collected logs without a shell | `pi-portable.exe --tools read,grep,find,ls -p 'Review these logs for authentication anomalies. Cite source files and lines.'` |
| Inspect network listeners | `pi-portable.exe -p 'Use PowerShell to list listening TCP ports and their owning processes.'` |
| Name a case session | `pi-portable.exe --name 'Case-042 host-01'` |
| Resume the previous session | `pi-portable.exe --continue` |
| Inspect portable paths and wrapper version | `pi-portable.exe --portable-info` |
| Show upstream Pi version | `pi-portable.exe --version` |

Search respects ignore rules such as `.gitignore`; it is not exhaustive forensic enumeration.

### Choose your tools

Default tools are `read,powershell,grep,find,ls`. PowerShell can modify the host. To work without a shell or dedicated editing tools:

```powershell
.\pi-portable.exe --tools read,grep,find,ls
```

To enable editing:

```powershell
.\pi-portable.exe --tools read,powershell,edit,write,grep,find,ls
```

An explicit `--tools` list replaces the portable default. Pi also accepts `--no-tools` and `--exclude-tools`. Tool selection is not an operating-system security boundary.

## How it works

```text
pi-portable.exe
  ├─ verifies and extracts the embedded Pi distribution
  ├─ creates the Ollama preset if configuration files are absent
  ├─ redirects Pi state and child temporary files to the portable home
  └─ starts Pi with the current working directory and console
       ├─ PowerShell / file and search tools → investigated system
       └─ model requests → Ollama Cloud
```

The EXE contains Pi's runtime, assets, native helpers, ripgrep, and fd. Later launches verify the cached runtime against the embedded archive. Concurrent launches serialize extraction; changed or incomplete expected runtime files cause startup to stop.

Arguments, piped input, working directory, and Pi's exit code are preserved. Interactive, print, JSON, and RPC modes remain available. `--portable-notices` prints the embedded upstream license notice.

### Where data lives

```text
pi-portable.exe
pi-portable-data/
├── runtime/<payload-sha256>/  Extracted distribution, search tools, licenses
├── agent/                    settings.json, models.json, ollama-cloud.key, Pi auth/state
├── sessions/                 Conversations grouped by working directory
├── tmp/                      Child-process temporary files
└── runtime.lock              Extraction/configuration lock
```

To store case data elsewhere or run the EXE from read-only media:

```powershell
$env:PI_PORTABLE_HOME = 'E:\IR\Case-042\pi-data'
D:\Tools\pi-portable.exe
```

Use an absolute path. Move the data folder too if you need the same sessions and credentials elsewhere. Treat it as sensitive case material: the wrapper does not encrypt credentials, conversations, or tool results.

The launcher overrides inherited Pi agent, session, and package paths. Explicit Pi arguments such as `--session-dir` can still direct output elsewhere.

### Model configuration

First launch creates `agent/models.json` and `agent/settings.json` from the embedded [model preset](config/models.json) and [settings preset](config/settings.json). Existing files are never overwritten.

Edit the portable copies to change the endpoint or model. Explicit `--provider` and `--model` arguments override saved defaults. The Ollama preset references `${OLLAMA_API_KEY}` at request time and caps configured output at 8,192 tokens per response.

For a local/private endpoint, follow [Pi's compatible-endpoint configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md#configure-a-compatible-endpoint). No model weights are included.

## Incident Response boundaries

- **Cloud evidence handling:** prompts and included tool results go to the selected provider, Ollama Cloud by default. Use an endpoint approved for your evidence-handling requirements.
- **Host changes:** Pi runs with the launching account's permissions. PowerShell and enabled integrations can modify the host. This is not a sandbox, forensic write blocker, or zero-artifact tool.
- **Host trust:** integrity checks detect changed expected runtime files. They cannot establish trust in a compromised host or stop a privileged attacker changing files after verification.
- **Automatic discovery:** normal launches disable project approval, AGENTS.md/CLAUDE.md discovery, extensions, skills, prompt templates, custom themes, and MCP. Explicit extension/skill paths can still load code or instructions.
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
| Wrapper | 0.3.0 — Linux x64 support |

Automated tests cover both launchers and actual tools using a local fake model, including default model selection and saved-key Bearer authentication. Linux tests also exercise a real pseudo-terminal for hidden input, replacement, and cancellation. No real provider account is used. Live Ollama account access and broader interactive TUI behavior still need validation. ARM64, macOS, and older operating systems are not validated targets.

## Build, update, and contribute

```powershell
git clone https://github.com/ricanwarfare/pi-portable.git
Set-Location pi-portable
pwsh -NoProfile -File .\scripts\build.ps1
node --test .\tests\launcher.test.mjs
node .\tests\runtime-smoke.mjs
```

Building requires Windows, PowerShell 7, and the .NET Framework C# compiler; tests also need Node.js 22+. A .NET SDK is not required. Builds download checksum-pinned official archives; cached archives allow subsequent builds without networking.

See [building and release instructions](docs/BUILDING.md), [contributing](CONTRIBUTING.md), and the [changelog](CHANGELOG.md). The [Windows and Linux workflow](.github/workflows/windows.yml) builds and tests both platforms before publication.

Update by downloading a new release and retaining your data folder. **Do not use `pi update self` to update the wrapper**: changing the extracted runtime can make its next integrity check fail. See [troubleshooting](docs/TROUBLESHOOTING.md) for recovery.

## Attribution and license

Pi Portable is a fork of the Pi coding agent for use as a portable asset in Incident Response. The current implementation is a distribution fork: original launcher and packaging code around unmodified upstream release binaries. Development of the agent itself belongs to [earendil-works/pi](https://github.com/earendil-works/pi).

Launcher code is available under the [MIT License](LICENSE). Pi's copyright and MIT notice are retained in [NOTICE.txt](NOTICE.txt). Dependencies retain their original licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and the extracted distribution. This project is not affiliated with or endorsed by Pi, Ollama, or DeepSeek.
