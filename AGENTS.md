# Maintenance

- Keep README, configuration, security boundaries and changelog aligned with implemented behavior.
- Preserve upstream attribution and pinned checksums. Never alter pi-response while maintaining this repository.
- Never commit credentials, sessions, generated executables, test certificates, or build caches.
- Run scripts/build.ps1 and scripts/test.ps1 before release. Run with -RequireStandardUser for no-admin validation.
- Tool profiles and fetch policy are application controls. Never describe them as OS sandboxing or a universal no-egress guarantee.
