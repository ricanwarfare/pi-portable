# Troubleshooting

## Identify paths and versions

`pi-portable.exe --portable-info` reports wrapper version, payload hash, and home without extracting. `--version` reports upstream Pi. Use an absolute `PI_PORTABLE_HOME`; relative values resolve from your current directory.

## Authentication fails

Set `OLLAMA_API_KEY` in the terminal that starts Pi. Setting it in another terminal does not update a running process. Verify your [Ollama key](https://ollama.com/settings/keys) and account access to `deepseek-v4.1-flash`.

Never paste keys into issues. Check that `agent/models.json` references `${OLLAMA_API_KEY}` and `https://ollama.com/v1`. Existing configuration is preserved; merge the templates in `config/` if an older data folder lacks the preset.

## Connection errors

Cloud inference still needs networking when startup downloads are disabled. Check DNS, proxies, TLS inspection, and access to `ollama.com`. The launcher does not install certificates or bypass TLS verification. Follow your organization's approved-endpoint policy.

## Read-only or unwritable location

Choose a writable home before running:

```powershell
$env:PI_PORTABLE_HOME = 'E:\IR\Case-042\pi-data'
D:\Tools\pi-portable.exe
```

The EXE may be on read-only media, but extraction and sessions need a writable home. There is no silent fallback to a profile/system-temp folder. Managed paths cannot contain symlinks or junctions.

## Runtime is incomplete or modified

Close instances using the runtime. Locate its hash directory with `--portable-info`, move that directory aside for inspection, and restart to extract a fresh copy. Retain `agent/` and `sessions/`.

Possible causes include interrupted extraction, antivirus quarantine, manual edits, or `pi update self`. Do not disable security tools or checksum checks. Verify the published checksum and follow your organization's tooling approval process.

## Update the wrapper

Download the new EXE and checksum, verify them, then replace the old EXE while it is not running. Retain your data directory. Different payloads use separate runtime directories; older runtimes remain available for inspection. Existing configuration is not automatically migrated.

## Missing PowerShell or incompatible Windows

The target is Windows x64 with .NET Framework 4.8 and Windows PowerShell. Pi prefers PowerShell 7 if available. PowerShell is not installed by the launcher. ARM64 and older Windows versions are not validated.

## Bug reports

Include wrapper/upstream versions, Windows version/architecture, command structure, and redacted errors. State whether a fresh portable home reproduces the issue and whether media is removable/read-only. Never attach auth files, sessions, keys, or case evidence.
