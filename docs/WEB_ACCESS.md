# Optional web access

Pi Portable 0.2.0 embeds the exact requested [pi-agent-web-access](https://pi.dev/packages/pi-agent-web-access) package, version **1.1.2**. Its package tools are `web_search` (Exa/Brave) and `fetch_content` (readable page content). The executable includes its JavaScript dependencies; target machines do not need npm, Node, a local browser, or a separate package installation.

```powershell
.\pi-portable.exe --web --profile edit --project C:\Projects\MyApp
```

This enables both tools in addition to your coding profile for this launch. Without `--web` or `web.enabled: true`, neither web tool is available and no search request is made. `--no-web` overrides an enabled config. To enable it in configuration:

```json
"web": {
  "enabled": true,
  "provider": "auto",
  "jina": false
}
```

Insert that property into your existing `portable.json`, retaining its model endpoint settings. `provider` may be `auto`, `exa` or `brave`; tool arguments can select a provider. The package's `/web-status` command is available when the package is enabled.

## Search providers and credentials

- **Exa without a key:** uses its public MCP service at `https://mcp.exa.ai/mcp`. No separate Pi MCP server installation is needed; the extension speaks the service's HTTP protocol itself.
- **Exa with `EXA_API_KEY`:** uses `https://api.exa.ai/answer` or `/search`. The inherited local 1,000-request/month budget is recorded at `<state>/web/exa-usage.json`. It is advisory local accounting, not a guarantee about provider charges or concurrency.
- **Brave with `BRAVE_API_KEY`:** uses `https://api.search.brave.com/res/v1/web/search`. Auto mode may fall back to Brave after Exa fails when its key is available.

Provide keys through the calling process environment/approved secret injection. The wrapper does not save them and does not read the host's Pi web-search configuration. Do not edit the extracted runtime to add credentials; integrity checks reject added/modified files. Model API credentials and custom model headers are never injected into web requests. Child processes still inherit process environment variables; this is not secret isolation from shell tools or debugging.

Search sends the query text to those providers. Be deliberate about asking an agent to research proprietary code, internal hostnames or sensitive material. The tools run only when requested by the agent after you enable web access; enabling them authorizes that application's search/page-fetch behavior. Network filtering can still block services and make searches fail. No public provider request is required during startup or installation on the target.

## Content fetching and Jina

Pages use direct HTTPS requests and HTML-to-Markdown extraction. The package does not run page JavaScript or provide a full browser. With no `allowedOrigins` setting, HTTPS pages reachable by the process are allowed, except the configured model origin. This includes internal HTTPS hosts; there is no DNS/private-address sandbox.

For a controlled environment, restrict page reads to exact origins:

```json
"web": {
  "enabled": true,
  "provider": "exa",
  "allowedOrigins": ["https://docs.company.example", "https://learn.microsoft.com"],
  "jina": false
}
```

An empty array disables direct page origins while leaving search enabled. Origins include scheme/host/port, without paths or trailing slash. Page redirects are checked at each hop, with at most five requests. Plain HTTP is accepted only for an explicitly listed content origin. Search-provider redirects are rejected. Do not treat these checks as an OS firewall or protection against a hostile same-user process/DNS rebinding.

The upstream package falls back to `https://r.jina.ai/` when direct extraction fails. This adapter blocks that fallback unless `web.jina` is explicitly true, since it sends the original page URL to another external service. Even when enabled, the original target must satisfy the same content-origin rules. Leave Jina off for confidential/internal pages. The original upstream timeout, provider fallback and page-extraction behavior otherwise remain intact.

## Internal compatible search mirrors

The package's Exa/Brave requests can be redirected to approved services that implement the same respective protocols:

```json
"web": {
  "enabled": true,
  "allowedOrigins": ["https://docs.company.example"],
  "endpoints": {
    "exaMcp": "https://search.company.example/exa/mcp",
    "exaAnswer": "https://search.company.example/exa/answer",
    "exaSearch": "https://search.company.example/exa/search",
    "brave": "https://search.company.example/brave/search"
  }
}
```

Only override the providers you use; omitted entries retain their public defaults. Keys are sent to the corresponding configured mirror, so use only trusted mirror URLs. HTTPS is required except explicit loopback test fixtures. The configured model origin cannot be used as a search/content origin. Search queries may appear in the mirror's request logs. The selected proxy mode and additional CA bundle apply to web traffic too. Search mirrors still need compatible API responses; this is not a generic arbitrary search-server adapter.

## Packaging and verification

The published npm package is preserved under `vendor/pi-agent-web-access/upstream`, with a lockfile, integrity/source identity, dependency notices and per-file hashes. Two derived-bundle adaptations move its Exa ledger to selected state and disable unused native canvas support. Pi's embedded SDK resolves the bundle imports through its TypeScript extension loader. Offline startup does not install packages or call public model/search endpoints. Tests exercise default-off, forced-off, Exa MCP/direct, Brave, real HTML extraction, credential separation, redirects/allowlists and concurrent request scopes using local fixtures only. Production provider availability/rate limits and enterprise network policy still need validation in your environment.
