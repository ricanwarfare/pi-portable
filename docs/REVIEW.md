# Repository review — 2026-10-16

Scope: maintained Windows/Linux launcher code, IR and web adapters, package/build scripts, upstream-update automation, release signing policy, tests, configuration, and documentation. The review included independent passes over the launchers, IR/web workflow, and CI/packaging, followed by regression tests. It did not audit all upstream Pi internals, prove a host trustworthy, or exercise a paid model/signing account.

## Findings addressed in 0.7.1

| Area | Finding | Result |
| --- | --- | --- |
| Analysis scope | Inspection tools could read outside a case despite prompt instructions | During `/analyze`, tool calls are checked for case containment, safe paths, and regular-file types; omitted search paths use the selected case |
| Report provenance | A replaced, internally re-manifested case could receive a report from an older analysis | Reports compare the current manifest with the analysis request and retain provider/model/request/source identifiers |
| Transferred cases | A FIFO/special artifact could block a read indefinitely | Bounded nonblocking reads require regular files before reading evidence and metadata |
| Session transitions | A session switch while disclosure/authentication was pending could use stale analysis state | Session-generation checks and evidence revalidation reject stale requests before submission |
| Key availability | A locked/unreadable saved key blocked version/help and explicit setup | Informational commands and reset setup no longer need to read the old key; managed-path checks remain |
| Build provenance | A local dirty build only recorded HEAD | Both build manifests record `sourceDirty`; official Windows release verification requires an actual Boolean false |
| Documentation | Build commands omitted signing tests and updater Python minimum | Build/test instructions and README are aligned with the maintained workflows |

These controls are application-level guards. They do not sandbox Pi, restrict ordinary shell use, or withstand a privileged attacker changing the host during execution. Report checks establish byte/hash and line-range consistency, not whether a model conclusion is correct.

## Verification

Regression coverage includes evidence replacement, report provenance, stale disclosures, outside-case model reads, omitted search paths, relative paths and aliases, synchronous submission failure, locked/unreadable keys, and malformed clean-tree metadata. The real bundled-runtime analysis test asks a fake provider to attempt an outside-case read and verifies that the secret sentinel never reaches it. Linux CI additionally checks FIFO rejection and real terminal key entry. Existing extraction, runtime integrity, web opt-in/cancellation, collector bounds, and updater tests remain required.

See [building](BUILDING.md) and the [release workflow](../.github/workflows/windows.yml) for the executable checks. The shipped Windows/Linux artifacts must pass those checks before publication; release manifests identify the source commit and final executable hashes.

## Remaining limits and recovery

- Trusted Windows signing is prepared but disabled pending an approved signing account. The real trusted-signature success path has not been exercised. See [signing setup](CODE_SIGNING.md).
- Tests use local fake providers. Live Ollama account/model access, wider interactive terminal coverage, and additional operating systems still need operator validation.
- Upstream Pi's void prompt-submission API can internally reject a request before emitting agent lifecycle events. If analysis remains marked pending without a running model, use `/new`, reopen the case with `/case`, and retry. Case files remain on disk. Automatic timeout-based removal of the path guard is deliberately avoided.
- Windows CIM/event collection can fail, time out, or require privileges; Linux utilities may be missing. Audit failures and partial evidence remain collection limitations. A live-host smoke test can fail on a slow CI runner even when timeout enforcement is working.
- Hash manifests are unsigned consistency records. They do not authenticate a transferred case or establish chain of custody. Session-only credentials avoid a launcher key file, not all host/session artifacts.

## Next additions worth prioritizing

1. **Local readiness check:** a `--response-doctor` command for shell/runtime/configuration/data-location checks, with network tests only when explicitly requested.
2. **Verified case handoff:** export/import one case with manifest verification and an allowlist of evidence/reports, excluding agent configuration, keys, and unrelated sessions.
3. **Investigation checklist and scope questions:** evaluate the two small RPIV candidates in [the extension survey](EXTENSIONS.md); do not introduce a full framework merely for task tracking.
4. **Case and coverage status:** show active case/host, provider, web state, and failed/truncated collector counts in the terminal.
5. **Offline IOC extraction:** validate and normalize candidate hashes/domains/IPs with artifact/line citations, separate from any explicitly requested online enrichment.

These are proposed capabilities, not release claims. No new third-party extension was bundled during this review.
