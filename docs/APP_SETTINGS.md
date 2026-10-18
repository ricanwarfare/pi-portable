# Double-click setup and in-app preferences

Double-click `pi-portable.exe`. On first use, the **Pi Portable settings** window opens. Existing configurations from before 0.4.0 also receive this setup window once on a double-click launch.

1. Choose your provider type and enter its API base URL and exact model ID. Choose Chat Completions (`openai-completions`) or Responses (`openai-responses`), as supported by your service. The wrapper appends the API route.
2. Choose Bearer, API-key or no authentication. Enter your key in the masked field. **Remember API key for this Windows account** is checked in the setup window; clear it if you want to enter a session-only key in the terminal instead.
3. Choose the default project folder and coding permissions: `review` reads/searches, `edit` also changes files, and `full` also runs native PowerShell.
4. Optionally set an approved PEM CA file, proxy mode (`env`, `direct`, or a proxy origin URL), and Azure deployment API version. Relative CA paths are resolved from the configuration file.
5. Check **Web access** and/or **Delegation** if you want them enabled on every launch. Then click **Save**.

The agent starts using those settings. On later double-click launches, it opens your remembered project with the same configured model and feature choices. No extra flags are needed. If a remembered key is missing or cannot be decrypted, setup opens again so you can replace it.

Inside the interactive agent, type **`/portable`** to open this settings window again. **`/web`** and **`/delegation`** open the same window. Change the checkboxes to enable or disable those features, or change the model/provider/key. **Save** persists the choices and automatically restarts the agent; it continues the most recent saved session for the selected project. **Cancel** leaves the running session and saved settings unchanged. With `--no-session`, restart starts a fresh session. A different default project continues that project's most recent saved session, if present.

Changing settings does not contact a model or search service. After restart, web searches use the configured search providers; Exa/Brave may require public connectivity unless approved internal mirrors are configured. Web and model credentials remain separate. See [WEB_ACCESS.md](WEB_ACCESS.md). Delegation uses foreground child agents within the configured model and tool profile; see [SUBAGENTS.md](SUBAGENTS.md).

## What is remembered

Provider, URL, model ID, API format, project folder, profile, feature toggles and non-secret options live in the selected `portable.json`. Existing custom headers, search mirrors and other advanced configuration are retained when the settings window saves. The GUI saves standard Bearer/API-key credentials; custom-header secrets and search-provider keys still use environment injection.

When Remember is selected, the model key is stored separately under `<state>\credentials\<endpoint-hash>.dpapi`, encrypted with Windows **DPAPI CurrentUser** and bound to the API endpoint/authentication mode. The clear-text key is never written into JSON, command arguments or generated model files. The field is blank when reopening settings: leave it blank to retain the saved key for that endpoint, or enter a replacement. Changing endpoint or authentication requires a key for that scope and removes the previous endpoint's saved key after saving. Clearing Remember removes the current endpoint's encrypted key.

This encryption is tied to the Windows user's profile and its DPAPI keys. Do not assume an encrypted credential will work on another account or computer after copying the portable directory; re-enter it there. Copying state to a different directory on the same Windows account is tested. Processes running as the same user may decrypt or inspect the key; this is storage protection, not isolation from local malware, shell tools or debugging. Keys exist in process memory/environment during use. Deleting a key file does not securely erase backups or recoverable filesystem data.

## Command-line behavior

Command-line launches remain session-only unless `rememberKey` is enabled and a saved key exists. Key lookup order is the configured `keyEnv` variable, then the saved key, then hidden terminal entry. `--session-key` skips both environment and saved-key lookup for that launch. It does not replace the saved key. A missing key in redirected/RPC mode fails without opening a dialog.

`--settings` explicitly opens the native window from an interactive Windows terminal. `/portable` is available only in the interactive terminal agent, not in print/RPC automation or as a model tool. Initial CLI flags override saved feature/profile/project preferences for that launch. Saving from `/portable` replaces those launch overrides with the newly saved choices and restarts; storage/config paths are retained.

Default state is beside the EXE in `pi-portable-data`. Use `--portable-storage user` or `--portable-home PATH` consistently if you want another state location. The GUI needs write access to the selected state/config location; it never elevates. The executable remains subject to enterprise execution and signing rules.
