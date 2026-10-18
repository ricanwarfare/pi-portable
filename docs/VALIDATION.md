# Local validation

Validated on October 18, 2026, using the actual Windows x64 distribution built from this source. The full suite ran with `scripts/test.ps1 -RequireStandardUser`, which reported `administrator token: False`.

Result for distribution 0.4.0: **33 tests passed, zero failures, zero skips**, approximately 186 seconds. The build succeeded using the pinned official Pi 1.3.0 runtime, bundled rg/fd, pi-agent-web-access 1.1.2 and pi-subagents 0.79.1 with their bundled dependencies; `--version` returned `1.3.0`. Native form, DPAPI, restart and settings-command tests join the existing runtime regressions. Settings tests are additionally rerun after final setup-recovery and inherited-terminal refinements; clean-source CI checks the final committed build. The output is unsigned. Release signature tests verify that an unsigned executable, changed bytes, wrong publisher, wrong commit and dirty-source manifests cannot pass the signed release gate.

| Area | Verified |
| --- | --- |
| Native launcher | Windows argument quoting, Unicode, stdin/exit propagation, hidden input/cancellation, no-admin token, long nested paths |
| State | EXE-only relocation, portable/user-profile selection, project roots/partitions, separate concurrent launch state |
| Runtime integrity | Modified/extra files, junctions and unsafe ZIP paths rejected; concurrent extraction serialized |
| Credentials | Session environment passed, redirected secret prompt rejected, key bytes absent from normal persisted state |
| Native settings | Real Windows form controls save/restore model, project and feature toggles; key input masked, advanced web settings retained, GUI commands registered in actual offline runtime |
| Remembered credentials | DPAPI round trip, endpoint/auth scope, wrong entropy and corrupted blob rejection, same-account relocation, endpoint replacement, blank-field retention, explicit forgetting and environment precedence |
| In-app changes | Cancel/failure do not request restart; successful Save restarts with persisted model/features and continues the selected project; print/RPC cannot open settings dialogs |
| Coding tools | Actual read, grep, find, ls, write, edit and native PowerShell with system-only PATH |
| Profiles and sessions | Narrower profile on resumed session; forbidden write request rejected; moved-project session fork |
| Transport | Actual local OpenAI-compatible SSE, Ollama without auth, Azure-style deployment path/version/API-key, custom Responses API/environment header |
| TLS | Additional test CA succeeds, unknown CA fails, inherited insecure TLS variable overridden |
| Proxy | Explicit CONNECT, environment routing, NO_PROXY bypass, direct mode ignoring an unreachable inherited proxy |
| Network policy | Redirect never reaches its destination; invalid policy exits before requests; public/unconfigured targets produce zero guard transport calls |
| Offline startup | Version without a reachable model/proxy; actual RPC initialization/EOF with zero sentinel endpoint/proxy requests |
| Optional web tools | Default/forced-off produce no web requests; actual bundled Exa MCP, Exa direct API, Brave and HTML-to-Markdown extraction under system-only PATH |
| Web boundaries | Search keys remain separate from model credentials, no keys in persisted test state, portable Exa ledger, redirect/content allowlists, independent Jina opt-in, asynchronous scope separation |
| Optional subagents | Actual embedded SDK child sessions, role discovery, default/forced-off, same model/profile, rejected detached/model changes, parallel overlap, chain handoff, child read and web search, no key bytes in persisted state |

All model/proxy traffic in the tests uses synthetic loopback services. Tests require no production credentials or public AI access. Certificate generation uses Git's OpenSSL and does not install trust into Windows. The host tool sandbox prevents some loopback/junction/OpenSSL operations, so the native test suite was run outside that tool sandbox under the same non-elevated Windows account. This did not grant administrator rights to the tests or application.

An additional proxy test caught a difference in the bundled Bun runtime's handling of direct-proxy options; direct mode now removes inherited proxy variables from the child environment. An actual extraction test caught legacy .NET path limits; the launcher now declares its .NET 4.8 target and long-path/asInvoker manifest. The final full suite includes both regressions.

Remaining validation boundaries: no corporate AppLocker/WDAC deployment, signed publisher/reputation, physical USB policy, live Azure tenant, production internal Ollama, live Exa/Brave/Jina service or rate-limit validation, NTLM/Kerberos/PAC/mTLS, native Windows ARM64 or Linux validation. The tests are not a packet-capture audit or a universal public-network sandbox guarantee. The signing service is unconfigured. See SECURITY.md and CODE_SIGNING.md.

GitHub CI independently builds/tests the pushed source; its current result is shown on the repository Actions page. Build manifests identify the source commit and actual artifact hashes; do not infer artifact provenance solely from this narrative report.
