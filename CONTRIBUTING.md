# Contributing

Pi Portable focuses on the Pi coding agent as a portable asset for Incident Response. Keep changes small, preserve upstream attribution, and describe their effects on investigated systems and case data.

Follow [docs/BUILDING.md](docs/BUILDING.md) to build and test. No provider credentials are required. Include targeted tests for extraction, environment handling, argument forwarding, or provider configuration changes.

Do not commit keys, auth files, case evidence, sessions, runtime directories, or build caches. Executables belong in GitHub Releases. Never disable checksum validation to work around a failed download.

Keep release changes in `CHANGELOG.md`; GitHub release notes are generated from it. Keep source, tests, configuration, licenses, and maintained documentation in Git. Generated files and local tooling state belong in ignored directories.

For bugs, include the wrapper version from `--portable-info`, upstream version from `--version`, Windows version, command structure, and redacted error. Remove tokens, customer identifiers, and case content before posting.

Pull requests should explain the problem, resulting behavior, and checks run. Dependency updates should link to official releases and identify checksum sources. Document any change to host writes, network calls, or automatic loading.

Agent-core changes generally belong in [upstream Pi](https://github.com/earendil-works/pi). This repository maintains the launcher, packaging, defaults, and tests. See [SECURITY.md](SECURITY.md) for vulnerability reporting.
