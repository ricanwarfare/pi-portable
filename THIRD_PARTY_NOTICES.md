# Third-party software

Pi Portable is an independent distribution. It embeds unmodified official Pi artifacts and adds a launcher plus a model-transport/tool-profile extension.

| Software | Pinned version/source | License |
| --- | --- | --- |
| Pi coding agent | 1.3.0, [earendil-works/pi](https://github.com/earendil-works/pi) | MIT, retained in NOTICE.txt and the official payload |
| Windows launcher/build/release foundation and icon | [ricanwarfare/pi-response](https://github.com/ricanwarfare/pi-response), commit 845c7dba1d250564797d961cceb21bccb7a62ea1 | MIT, retained in LICENSE |
| ripgrep | 15.2.0, [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | MIT or Unlicense, retained in runtime tools/rg |
| fd | 10.5.0, [sharkdp/fd](https://github.com/sharkdp/fd) | MIT or Apache-2.0, retained in runtime tools/fd |
| pi-agent-web-access | 1.1.2, [santychuy/pi-setup](https://github.com/santychuy/pi-setup), source c4bd7b9d459bc510283b91202449abb4c2f7bfc6 | MIT, retained in vendor/pi-agent-web-access/LICENSE |

Archive URLs and SHA256 pins are in upstream-release.json. Original payload documentation and license files are retained. Pi's executable includes its own Bun runtime and transitive dependencies with their original licenses; this table is not a complete transitive SBOM. `--portable-notices` displays the embedded Pi MIT notice and derivation attribution. No pi-web-search package, IR extension or Linux/Go launcher is included.

The requested web-access package is retained unmodified under `vendor/pi-agent-web-access/upstream`. Its derived runtime bundle includes Readability, linkedom, p-limit, turndown, typebox and transitive dependencies. Their exact versions, declared licenses and retained notice filenames are enumerated in `web-access-release.json`; original license/package files live under `vendor/pi-agent-web-access/licenses` and are embedded with the bundle. The author's repository MIT license is also retained because its npm archive omits a standalone LICENSE file. See BUILDING.md for the two documented portable adaptations. esbuild is development-only and is not shipped as a runtime executable.

Build/test tooling such as .NET Framework, Node.js, Git/OpenSSL and GitHub Actions is supplied separately on the development machine or CI runner and is not installed on target machines by this repository.
