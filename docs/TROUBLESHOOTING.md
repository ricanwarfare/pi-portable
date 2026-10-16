# Troubleshooting

## Identify paths and versions

`pi-response.exe --response-info` reports wrapper version, payload hash, and home without extracting. `--version` reports upstream Pi. Use an absolute `PI_RESPONSE_HOME`; relative values resolve from your current directory.

## Authentication fails

On a normal interactive launch, the wrapper asks for an Ollama key if none is saved or configured. Run `pi-response.exe --response-setup` to replace the launcher-saved key. It is saved in plaintext at `agent/ollama-cloud.key`; protect the drive. Escape or Ctrl+C cancels setup without changing the saved key.

`OLLAMA_API_KEY` in the launching terminal overrides the launcher-saved value. Pi's own credentials in `auth.json` take precedence over both; manage those through Pi's `/login` and `/logout`. Verify your [Ollama key](https://ollama.com/settings/keys) and access to `deepseek-v4.1-flash`.

Automation/RPC and redirected input/output do not prompt. Set the environment variable or complete setup in an interactive terminal first. Setup stores the key but does not validate it with the cloud service; an invalid key is reported by Pi when making a request.

Never paste keys into issues. Check that `agent/models.json` references `${OLLAMA_API_KEY}` and `https://ollama.com/v1`. Existing configuration is preserved; merge the templates in `config/` if an older data folder lacks the preset.

## Connection errors

Cloud inference still needs networking when startup downloads are disabled. Check DNS, proxies, TLS inspection, and access to `ollama.com`. The launcher does not install certificates or bypass TLS verification. Follow your organization's approved-endpoint policy.

## Read-only or unwritable location

Choose a writable home before running:

```powershell
$env:PI_RESPONSE_HOME = 'E:\IR\Case-042\pi-data'
D:\Tools\pi-response.exe
```

The EXE may be on read-only media, but extraction and sessions need a writable home. There is no silent fallback to a profile/system-temp folder. Managed paths cannot contain symlinks or junctions.

## Runtime is incomplete, modified, or contains unexpected files

Close instances using the runtime. Locate its hash directory with `--response-info`, move that directory aside for inspection, and restart to extract a fresh copy. Retain `agent/` and `sessions/`.

Both platforms reject untracked runtime files and symlinks/junctions, including files in extra subdirectories. Keep custom scripts, tools, and evidence outside `runtime/`.

Possible causes include interrupted extraction, antivirus quarantine, added files, manual edits, or `pi update self`. Do not disable security tools or checksum checks. Verify the published checksum and follow your organization's tooling approval process.

## Update the wrapper

Download the new EXE and checksum, verify them, then replace the old EXE while it is not running. Retain your data directory. Different payloads use separate runtime directories; older runtimes remain available for inspection. Existing configuration is not automatically migrated.

## Missing PowerShell or incompatible Windows

The target is Windows x64 with .NET Framework 4.8 and Windows PowerShell. Pi prefers PowerShell 7 if available. PowerShell is not installed by the launcher. ARM64 and older Windows versions are not validated.

## Linux: permission denied or incompatible executable

Run `chmod +x pi-response-linux-x64` and launch from a terminal or SSH session. The current Linux target is x64 on glibc-based distributions, tested on Ubuntu 22.04 and 24.04. ARM64 and Alpine/musl are not supported by this artifact. Bash must be present.

If the USB or data location is mounted `noexec`, move the executable to a location allowing execution and set `PI_RESPONSE_HOME` to a writable, executable location too. Both the native launcher and extracted Pi runtime need execution permission. Inspect mounts with `findmnt -T /path/to/file`. The launcher does not change mounts or require root.

New data folders request `0700` and key files request `0600`. FAT/exFAT mount options may override Unix permissions. Saved keys remain plaintext.

## Bug reports

Include wrapper/upstream versions, Windows version/architecture, command structure, and redacted errors. State whether a fresh portable home reproduces the issue and whether media is removable/read-only. Never attach auth files, sessions, keys, or case evidence.
