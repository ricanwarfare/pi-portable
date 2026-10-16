# Incident response workflow

## Collect without an API key

Run the executable with `--portable-triage` by itself:

```powershell
.\pi-portable.exe --portable-triage
```

```bash
./pi-portable-linux-x64 --portable-triage
```

This runs fixed collectors locally, makes **no model request**, and prints a new case folder under `pi-portable-data/cases/`. It does not prompt for a key or create a conversation. Ordinary interactive Pi startup still uses the configured provider and first-run key setup.

| Command inside Pi | Collection scope |
| --- | --- |
| `/triage [label]` | All six groups, in a new case |
| `/host [label]` | OS, boot/uptime information, shell version |
| `/processes [label]` | Process IDs, parents, command lines, start times |
| `/network [label]` | Windows TCP connections; Linux TCP/UDP socket snapshot |
| `/persistence [label]` | Windows startup entries, automatic services, scheduled tasks; Linux system crontab and enabled systemd unit files |
| `/logons [label]` | Windows: up to 200 selected Security logon events from the last day; Linux: up to 50 `last` records |
| `/timeline [label]` | Up to 200 recent Windows System or Linux journal events; a raw event snapshot, not a complete reconstructed timeline |

Each collection command creates a separate case. Collectors have a 30-second limit each, a 1 MiB stdout limit, and a 64 KiB stderr limit. Missing tools, access-denied errors, timeouts, and output truncation are recorded. No automatic elevation or remediation is performed. Review `collection-report.md` before drawing conclusions. If collection is interrupted, an incomplete folder may remain and will fail `/case` verification; keep it for inspection and collect again.

## Analyze on your workstation

Copy the **whole case folder** to your workstation. Start Pi Portable in a fresh session, then enter:

```text
/case E:\Cases\20261016T015414958Z-4c65de24
/analyze
/report
```

Use the actual folder name printed during collection. Linux paths work too; paths with spaces can be enclosed in double quotes. The source host may differ from the current platform.

`/case` verifies hashes and rejects symlinks/junctions. `/analyze` explains that case evidence will go to the selected model provider and asks you to confirm. It selects `read,grep,find,ls` and directs the model to analyze existing evidence rather than collect from your workstation. It is an interactive command. Tool selection and instructions are not a filesystem sandbox.

After analysis finishes, `/report` exports new `analysis-<id>.md`, `.json`, and `.sha256` files. Each finding must identify itself as an observation or hypothesis, state confidence, and cite an existing evidence file with a valid, nonempty line range. Modified evidence, unknown artifacts, invalid JSON, and out-of-range citations prevent export. **Citation validation checks the source location, not whether the model interpreted it correctly.** Analyst review is required. If export fails, rerun `/analyze`; it requests the expected JSON schema again. Empty findings are valid when evidence is insufficient.

You can review the raw evidence and collection report without a model, or use `analysis-prompt.txt` with your approved analysis workflow. The prompt records the original collection path; update that path when using it manually after moving a case. `/analyze` generates the current path automatically.

## Case contents

```text
<case-id>/
  case.json                    Host/operator/version metadata and evidence hashes
  audit.json                   Exact collector commands, UTC start/end, status, limits
  evidence/*.stdout.txt        Collected bytes; not rewritten by analysis
  evidence/*.stderr.txt        Errors and warnings, including permission failures
  collection-report.md         Coverage and status summary
  analysis-prompt.txt          Instructions for analyzing the bundle
  SHA256SUMS                   Collection files, including case.json
  analysis-request-<id>.json   Provider/model, request time, case-index hash (when used)
  analysis-<id>.json           Structured findings (after /report)
  analysis-<id>.md             Analyst-readable report (after /report)
  analysis-<id>.sha256         Checksums of the exported report pair
```

Model-analysis records and reports are created separately. The original collection manifest remains unchanged. The audit covers bundled collectors, not unrelated shell commands you ask Pi to run. It records configured wrapper/upstream/collector versions; the host collector records its shell version. Case metadata identifies the account running collection, not an independently authenticated investigator.

Linux directories/files are created with owner-only permissions where supported. Windows permissions follow the chosen folder's ACL. Case files and saved keys are not encrypted. Protect your response drive and transferred evidence.

## Operational limits

Live triage leaves a footprint. These collectors do not acquire memory, image disks, enumerate every persistence mechanism, or prove a host is clean. A compromised host can falsify commands and output; unsigned hashes do not establish authenticity or chain of custody. Case files can contain sensitive command lines and logon details. Use an approved model provider.

An empty or failed collector means unknown coverage, not absence of activity. Windows Security events often require additional privileges. Linux utilities such as `ss`, `last`, `systemctl`, or `journalctl` may be absent or lack access. Persistence collection does not cover all registry locations, user crontabs, systemd user services, shell startup files, or every scheduled mechanism. Event collection is capped, and raw timestamps may use source-specific conventions. Validate the host clock and timezone before correlating events.

Bundled web research is off by default. `/web on` enables the package's `web_search` and supported `url_context` tools after a disclosure; `/web off` cancels active web requests. Every collector and `/analyze` turn web access off, and case analysis cannot re-enable it while running. Research separately after analysis, using public terms. General shell tools can still make network requests when asked; this is not a network sandbox.

Ollama Cloud research reuses the saved API key. Queries and supplied URLs go to the search provider and may incur charges. Do not submit private case data. Results/source URLs stay in the conversation when sessions are saved; external research is not silently merged into the collection manifest or the validated case-analysis report. See [web research](../README.md#web-research) for commands and provider configuration. Automatic IOC enrichment and file uploads are not part of this integration.
