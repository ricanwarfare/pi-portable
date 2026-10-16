# Third-party software

Pi Portable is an independent Incident Response distribution fork of the [Pi coding agent](https://github.com/earendil-works/pi), redistributing unmodified official artifacts inside a self-extracting launcher.

| Software | Version | Source | License |
| --- | --- | --- | --- |
| Pi coding agent | 1.3.0 | [earendil-works/pi](https://github.com/earendil-works/pi) | MIT; retained in [NOTICE.txt](NOTICE.txt) |
| ripgrep | 15.2.0 | [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | MIT or Unlicense; retained under `runtime/<hash>/tools/rg/` |
| fd | 10.5.0 | [sharkdp/fd](https://github.com/sharkdp/fd) | MIT or Apache-2.0; retained under `runtime/<hash>/tools/fd/` |
| Go runtime (Linux launcher) | CI builds with Go 1.27.2 | [golang/go](https://github.com/golang/go) | BSD-3-Clause; retained in [GO-LICENSE.txt](assets/licenses/GO-LICENSE.txt) and Linux runtime `licenses/` |
| pi-web-search | 1.7.0 | [ttttmr/pi-web-search](https://github.com/ttttmr/pi-web-search) | MIT as declared by the package; original [README](vendor/pi-web-search/README.md) and [package metadata](vendor/pi-web-search/package.json) retained in source and runtime |

Pi's official executable includes its own runtime and dependencies, which retain their original licenses. This table identifies directly downloaded distributions, not an exhaustive SBOM of Pi's transitive dependencies.

Release archive URLs and SHA256 pins are recorded in [upstream-release.json](upstream-release.json) and [upstream-linux-release.json](upstream-linux-release.json). Search-tool documentation and licenses are retained. Pi's MIT notice is embedded and available through either executable's `--portable-notices` flag.

Ollama Cloud and DeepSeek are external service/model providers. Their service terms and account requirements apply separately.

pi-web-search is authored by ttttmr and its contributors. Its published package declares MIT but does not contain a separate license file; the complete published source, README, and package metadata are retained unmodified. [web-search-release.json](web-search-release.json) pins the npm archive's SHA-256/SHA-512 integrity and individual file hashes. Pi Portable's opt-in adapter is separate original code.
