# Building and provenance

The development machine needs Windows x64, .NET Framework 4.8 (including its C# compiler), PowerShell 7 and Node.js 22+. Git/OpenSSL is used to generate local test CA certificates. Target machines only need the Windows runtime prerequisites in README; they do not need development tools or administrator rights.

Run `scripts/build.ps1`, then `scripts/test.ps1 -RequireStandardUser` from a non-elevated terminal. The first build requires GitHub downloads; subsequent builds use `.build` cache and verify the pinned hashes on every build. Runtime startup never downloads those assets. Build the distribution on an internet-enabled machine and carry the EXE into the filtered environment.

`upstream-release.json` pins Pi 1.3.0, ripgrep 15.2.0 and fd 10.5.0. All original archive files, license notices and documentation are retained. Only the two portable policy modules are added. No npm install, local Bun, SDK compilation, or Pi source rebuild is involved. The inherited `.NET` launcher is compiled as x64 and embeds the payload, notice, and empty model/settings resources. Its application manifest declares `asInvoker` and long-path awareness, and its target framework is explicitly 4.8.

The full payload is verified before extraction; cached files are verified before each launch. Unexpected or modified runtime files cause a refusal. Stop all running instances, move the named runtime directory aside, and retry to extract a fresh copy. Do not manually patch extracted runtime files.

The build manifest records source commit/dirty status, upstream pins, payload hash, EXE hash and signing status. The zip composition/compiler do not promise byte-for-byte reproducible output: generated zip metadata may differ. The hashes identify actual output bytes. Fixture builds are clearly marked with `upstream: null` and cannot be treated as official distributions.

Tests compile an independent C# child fixture for argument/environment/exit behavior, a deliberately unsafe archive for traversal rejection, and an input fixture for hidden-entry/cancellation behavior. Runtime tests invoke the actual shipped EXE with a system-only PATH, synthetic model servers and fresh test CA. They never install a machine CA. Junction fixtures can require filesystem permission that a restrictive tool sandbox denies; run the tests directly in your standard-user Windows terminal. Build/test scripts remain subject to enterprise execution policy.

CI runs builds/tests, uploads artifacts, optionally signs a verified Windows artifact, then publishes only on a tag that matches version.json. A successful local suite does not replace that clean-source CI release gate. `WINDOWS_SIGNING_MODE=azure` enables the signing job; any unsupported signing mode blocks release. The pipeline inherits the source project's publisher/timestamp/provenance validation. See CODE_SIGNING.md.

Windows x64 is the only supported build target. The upstream runtime determines CPU/OS requirements. Linux/ARM targets from pi-response were deliberately not copied because this scope is no-admin Windows. Corporate policy and removable-drive behavior require validation on your actual managed machines.
