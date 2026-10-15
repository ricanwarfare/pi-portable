# Third-party software

Pi Portable is an independent Incident Response distribution fork of the [Pi coding agent](https://github.com/earendil-works/pi), redistributing unmodified official artifacts inside a self-extracting launcher.

| Software | Version | Source | License |
| --- | --- | --- | --- |
| Pi coding agent | 1.3.0 | [earendil-works/pi](https://github.com/earendil-works/pi) | MIT; retained in [NOTICE.txt](NOTICE.txt) |
| ripgrep | 15.2.0 | [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | MIT or Unlicense; retained under `runtime/<hash>/tools/rg/` |
| fd | 10.5.0 | [sharkdp/fd](https://github.com/sharkdp/fd) | MIT or Apache-2.0; retained under `runtime/<hash>/tools/fd/` |

Pi's official executable includes its own runtime and dependencies, which retain their original licenses. This table identifies directly downloaded distributions, not an exhaustive SBOM of Pi's transitive dependencies.

Release archive URLs and SHA256 pins are recorded in [upstream-release.json](upstream-release.json). Search-tool documentation and licenses are retained during packaging. Pi's MIT notice is embedded and available through `pi-portable.exe --portable-notices`.

Ollama Cloud and DeepSeek are external service/model providers. Their service terms and account requirements apply separately.
