import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { isIP } from 'node:net';

export function validateConfig(config) {
  const base = new URL(config.baseUrl);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Endpoint must be HTTP(S), without credentials, query or fragment');
  const host = base.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || /^127\./.test(host) && isIP(host) === 4;
  if (base.protocol === 'http:' && !loopback && config.allowHttp !== true)
    throw new Error('Non-loopback HTTP requires allowHttp: true; prefer internal HTTPS');
  if (!['none', 'bearer', 'api-key'].includes(config.auth)) throw new Error('Invalid auth mode');
  if (config.kind === 'azure' && !config.apiVersion) throw new Error('Azure requires apiVersion');
  if (config.apiVersion && !/^[A-Za-z0-9.-]+$/.test(config.apiVersion)) throw new Error('Invalid API version');
  return base;
}

// Exact target path and origin; redirects never receive credentials or trigger a second fetch.
// This guard covers Pi's fetch-based model traffic. It is not an OS network sandbox.
export function createGuard(config, { fetch: transport, env = process.env, read = readFileSync, report = () => {} } = {}) {
  const base = validateConfig(config);
  const route = `${base.pathname.replace(/\/$/, '')}/${config.api === 'openai-responses' ? 'responses' : 'chat/completions'}`;
  const endpoint = new URL(base); endpoint.pathname = route;
  if (config.kind === 'azure') endpoint.searchParams.set('api-version', config.apiVersion);
  const proxyMode = config.proxy ?? 'env';
  if (proxyMode !== 'env' && proxyMode !== 'direct') {
    const proxy = new URL(proxyMode);
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== '/' || proxy.search || proxy.hash)
      throw new Error('Proxy must be an HTTP(S) origin without credentials; use proxy environment variables for credentials');
  }
  const ca = config.caFile ? [...rootCertificates, read(config.caFile, 'utf8')] : undefined;
  const customHeaders = new Headers();
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (['authorization', 'api-key', 'host', 'proxy-authorization', 'content-length', 'connection', 'transfer-encoding'].includes(name.toLowerCase()))
      throw new Error('Reserved header in config');
    if (typeof value !== 'string') throw new Error('Header values must be strings');
    customHeaders.set(name, value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
      if (!env[key]) throw new Error(`Missing header environment variable ${key}`);
      return env[key];
    }));
  }
  return async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== base.origin || url.pathname !== route || url.search || url.hash || request.method !== 'POST')
      throw new Error('Pi Portable blocked a request outside the configured model endpoint');
    const headers = new Headers(request.headers);
    headers.delete('authorization'); headers.delete('api-key'); headers.delete('proxy-authorization');
    for (const [name, value] of customHeaders) headers.set(name, value);
    if (config.auth !== 'none') {
      const key = env.PI_PORTABLE_RUNTIME_KEY;
      if (!key) throw new Error('Missing session API key');
      headers.set(config.auth === 'api-key' ? 'api-key' : 'authorization', config.auth === 'api-key' ? key : `Bearer ${key}`);
    }
    const options = {
      method: request.method, headers, body: request.body, signal: request.signal,
      redirect: 'manual', duplex: 'half',
      // Direct-mode child environments have all proxy variables removed by the launcher.
      ...(['direct', 'env'].includes(proxyMode) ? {} : { proxy: proxyMode }),
      tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    };
    const response = await transport(endpoint.href, options);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      report('Pi Portable blocked an endpoint redirect; configure the final endpoint URL.');
      throw new Error('Pi Portable blocked an endpoint redirect');
    }
    return response;
  };
}
