# Updating Pi Portable

## Keep the repository current

[Check upstream Pi](https://github.com/ricanwarfare/pi-portable/actions/workflows/upstream-update.yml) runs daily at approximately **09:23 UTC**. You can also select **Run workflow** on `main` to check immediately. Scheduled runs depend on GitHub Actions availability and repository settings.

For a newer stable [official Pi release](https://github.com/earendil-works/pi/releases/latest), it downloads the Windows x64 ZIP, verifies its size and SHA256 against GitHub's asset metadata, and prepares `automation/pi-vVERSION`. It opens a pull request when repository policy permits bot-created PRs; otherwise its run summary contains an **Open the prepared update PR** link. It updates the Pi pin, distribution version, README version and changelog together. Existing ripgrep/fd and extension pins are preserved. Missing digests/assets, prereleases, changed assets for an existing version and downgrades fail rather than silently changing the package.

The bot explicitly dispatches **Windows build and release** on the update branch so the complete build/test suite runs independently of bot-created pull request event behavior. Look under **Actions** for the run whose branch and commit match the PR. Repeated checks preserve an existing update branch's commits and reuse its open PR; they can retry its build. The workflow never force-pushes. A same-version no-op does not download the ZIP or create a PR.

1. Open **Check upstream Pi**'s run summary and follow the update PR link (create the PR from the prepared branch when needed). Review its linked upstream changes, especially extension/SDK compatibility. Adjust our adapters if needed.
2. Confirm the branch's **Windows build and release** run succeeds, then merge the PR. Main is independently built and tested again.
3. Open [Publish release](https://github.com/ricanwarfare/pi-portable/actions/workflows/publish-release.yml), select **Run workflow**, keep branch **main**, and run it.
4. Open the resulting **Windows build and release** run for `vVERSION`. It rebuilds and tests the tagged source, then publishes the EXE, checksum and manifest under [Releases](https://github.com/ricanwarfare/pi-portable/releases).

The publication button derives the version from the merged files; no tag typing or local compiler is needed. It requires portable and Pi versions to match and a changelog section to exist. It creates a lightweight tag at the selected main commit, explicitly dispatches the existing release gate, and never overwrites a release, draft or conflicting tag. If dispatch/build fails before publication, retrying is allowed only when that tag still names the same commit. Fixing a failed tagged build on another commit requires a deliberate version/tag decision; tags are never moved automatically. Signing follows the repository's signing policy; it is currently unconfigured, so releases are unsigned.

The automation uses the repository's temporary `GITHUB_TOKEN`. No personal access token is needed. The update workflow requests contents, pull-request and Actions write permissions. It never approves or merges PRs. This repository's **Allow GitHub Actions to create and approve pull requests** setting remains disabled: GitHub combines creation and approval permission in that setting. The prepared-branch/manual-PR fallback works with that restriction. If an owner has separately enabled bot PRs, creation is automatic. Organization rules can also block branch pushes or workflow dispatch; such failures appear under Actions and GitHub's configured workflow notifications. The workflows do not alter repository permissions.

## Update a portable copy

1. Close all running Pi Portable instances.
2. Back up the selected state folder (normally `pi-portable-data` beside the EXE).
3. Download `pi-portable.exe` and its `.sha256` from the new release and verify the checksum as shown in the README.
4. Replace only the EXE in the existing folder. Keep `pi-portable-data` in place and start the new EXE.

Saved provider/model, feature preferences, credentials and project sessions stay in the selected state folder. The launcher verifies/extracts the new runtime; runtime caches should not be patched. Remembered keys retain their Windows DPAPI user/profile restriction. Configuration/session compatibility with a new Pi version is subject to the reviewed upstream changes; keep the backup and prior EXE for rollback. Enterprise execution policy still applies.

No updater is added to the executable. Offline startup makes no update request, and restricted machines need no GitHub access. Download on an internet-enabled machine and transfer the EXE/checksum when necessary. Private releases require access to this repository.

## Local alternative

On the internet-enabled development machine, with Node.js 22+, Git and authenticated GitHub CLI installed, use a clean checkout:

```powershell
node scripts/update-upstream.mjs --check # Verify the latest candidate without changing tracked files.
node scripts/update-upstream.mjs         # Prepare the version/pin/documentation changes locally.
./scripts/build.ps1
./scripts/test.ps1 -RequireStandardUser
```

Review/commit those changes and open a PR. No production model credentials are needed. The script obtains official release metadata via GitHub CLI, independently hashes the public asset download without sending credentials, and changes only the four release files listed above. It never executes the download. Tool and extension package updates remain separate reviewed changes.
