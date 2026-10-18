import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';

export const webScope = new AsyncLocalStorage();
export const searchEndpoints = {
  exaMcp: 'https://mcp.exa.ai/mcp',
  exaAnswer: 'https://api.exa.ai/answer',
  exaSearch: 'https://api.exa.ai/search',
  brave: 'https://api.search.brave.com/res/v1/web/search',
};

export function createWebGuard(config, { fetch: transport, read = readFileSync } = {}) {
  const web = config.web ?? {};
  if (typeof web !== 'object' || Array.isArray(web) || web === null) throw new Error('web must be an object');
  for (const key of Object.keys(web))
    if (!['enabled', 'provider', 'allowedOrigins', 'jina', 'endpoints'].includes(key)) throw new Error('Unknown web field');
  if (web.enabled !== undefined && typeof web.enabled !== 'boolean') throw new Error('web.enabled must be boolean');
  if (web.jina !== undefined && typeof web.jina !== 'boolean') throw new Error('web.jina must be boolean');
  if (!['auto', 'exa', 'brave'].includes(web.provider ?? 'auto')) throw new Error('Invalid web provider');
  const modelOrigin = new URL(config.baseUrl).origin;
  const origins = web.allowedOrigins;
  if (origins !== undefined && (!Array.isArray(origins) || origins.some(origin => {
    try { const url = new URL(origin); return url.origin !== origin || !['http:', 'https:'].includes(url.protocol); } catch { return true; }
  }))) throw new Error('web.allowedOrigins must be an array of exact HTTP(S) origins');
  const endpoints = {};
  if (web.endpoints !== undefined && (typeof web.endpoints !== 'object' || !web.endpoints || Array.isArray(web.endpoints))) throw new Error('Invalid search endpoint map');
  for (const [name, value] of Object.entries(web.endpoints ?? {})) {
    if (!Object.hasOwn(searchEndpoints, name)) throw new Error('Unknown search endpoint');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.origin === modelOrigin)
      throw new Error('Invalid search endpoint');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Search endpoints require HTTPS except loopback fixtures');
    endpoints[name] = url;
  }
  const tls = { rejectUnauthorized: true, ...(config.caFile ? { ca: [...rootCertificates, read(config.caFile, 'utf8')] } : {}) };
  const contentTarget = url => {
    if (url.username || url.password || url.origin === modelOrigin || !['https:', 'http:'].includes(url.protocol)) throw new Error('Web target is not permitted');
    if (origins !== undefined) {
      if (!origins.includes(url.origin)) throw new Error('Web target is outside web.allowedOrigins');
    } else if (url.protocol !== 'https:') throw new Error('Web content requires HTTPS unless explicitly allowed by origin');
  };
  return async (input, init = {}) => {
    if (web.enabled !== true || !webScope.getStore()) throw new Error('Web access is disabled outside web tools');
    const request = new Request(input, init);
    const original = new URL(request.url);
    if (original.username || original.password || original.origin === modelOrigin) throw new Error('Web target is not permitted');
    const search = Object.entries(searchEndpoints).find(([, endpoint]) => {
      const expected = new URL(endpoint); return original.origin === expected.origin && original.pathname === expected.pathname;
    });
    let url = new URL(original);
    if (search) {
      if ((search[0] === 'brave' && request.method !== 'GET') || (search[0] !== 'brave' && request.method !== 'POST')) throw new Error('Invalid search method');
      if (endpoints[search[0]]) { url = new URL(endpoints[search[0]]); url.search = original.search; }
    } else if (original.origin === 'https://r.jina.ai') {
      if (web.jina !== true) throw new Error('Jina fallback is disabled; set web.jina to true to share page URLs with that service');
      contentTarget(new URL(original.pathname.slice(1) + original.search));
    } else {
      if (request.method !== 'GET') throw new Error('Web content requests must use GET');
      contentTarget(url);
    }
    const headers = new Headers(request.headers);
    for (const name of ['authorization', 'api-key', 'proxy-authorization', 'cookie', 'host', ...Object.keys(config.headers ?? {})]) headers.delete(name);
    if (search?.[0] !== 'exaAnswer' && search?.[0] !== 'exaSearch') headers.delete('x-api-key');
    if (search?.[0] !== 'brave') headers.delete('x-subscription-token');
    for (let hop = 0; ; hop++) {
      const response = await transport(url.href, {
        method: request.method, headers, body: request.method === 'GET' ? undefined : request.body,
        signal: request.signal, redirect: 'manual', duplex: 'half', tls,
        ...(!['direct', 'env'].includes(config.proxy ?? 'env') ? { proxy: config.proxy } : {}),
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get('location'); await response.body?.cancel();
      if (search || original.origin === 'https://r.jina.ai' || !location || hop >= 4) throw new Error('Web provider redirect blocked or too many redirects');
      url = new URL(location, url); contentTarget(url);
    }
  };
}
