import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGuard, validateConfig } from '../src/network.mjs';

const config = { kind: 'openai', baseUrl: 'https://model.internal/v1', auth: 'bearer', proxy: 'direct' };
const env = { PI_PORTABLE_RUNTIME_KEY: 'synthetic-session-secret' };
const request = { method: 'POST', body: '{}', headers: { authorization: 'Bearer wrong' } };

test('guard sends only the exact configured route with session credentials and strict TLS', async () => {
  let calls = 0;
  const guard = createGuard(config, { env, fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://model.internal/v1/chat/completions');
    assert.equal(options.headers.get('authorization'), 'Bearer synthetic-session-secret');
    assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.proxy, undefined);
    return new Response('ok');
  } });
  assert.equal(await (await guard('https://model.internal/v1/chat/completions', request)).text(), 'ok');
  for (const url of ['https://api.openai.com/v1/chat/completions', 'https://model.internal/v1/models', 'https://model.internal/v1/chat/completions?key=bad', 'http://model.internal/v1/chat/completions', 'https://model.internal:444/v1/chat/completions'])
    await assert.rejects(guard(url, request), /blocked/);
  await assert.rejects(guard('https://model.internal/v1/chat/completions'), /blocked/);
  assert.equal(calls, 1);
});

test('redirects are rejected without following or forwarding a second credentialed request', async () => {
  let calls = 0;
  const guard = createGuard(config, { env, fetch: async () => { calls++; return new Response(null, { status: 307, headers: { location: 'https://public.example/' } }); } });
  await assert.rejects(guard('https://model.internal/v1/chat/completions', request), /redirect/);
  assert.equal(calls, 1);
});

test('Azure deployment routes, api-key auth and version query are explicit', async () => {
  const guard = createGuard({ ...config, kind: 'azure', baseUrl: 'https://azure.internal/openai/deployments/coder', auth: 'api-key', apiVersion: '2024-10-21' }, { env, fetch: async (url, options) => {
    assert.equal(url, 'https://azure.internal/openai/deployments/coder/chat/completions?api-version=2024-10-21');
    assert.equal(options.headers.get('api-key'), env.PI_PORTABLE_RUNTIME_KEY);
    assert.equal(options.headers.has('authorization'), false);
    return new Response('ok');
  } });
  await guard('https://azure.internal/openai/deployments/coder/chat/completions', request);
  assert.throws(() => validateConfig({ ...config, kind: 'azure' }), /apiVersion/);
});

test('Responses-compatible custom endpoints and environment headers', async () => {
  const guard = createGuard({ ...config, api: 'openai-responses', auth: 'none', headers: { 'X-Internal-Token': '${TOKEN}' } }, { env: { TOKEN: 'synthetic' }, fetch: async (url, options) => {
    assert.equal(url, 'https://model.internal/v1/responses');
    assert.equal(options.headers.get('X-Internal-Token'), 'synthetic');
    assert.equal(options.headers.has('authorization'), false);
    return new Response('ok');
  } });
  await guard('https://model.internal/v1/responses', request);
  assert.throws(() => createGuard({ ...config, headers: { authorization: 'bad' } }), /Reserved/);
  assert.throws(() => createGuard({ ...config, headers: { 'X-Token': '${MISSING}' } }, { env: {} }), /Missing/);
});

test('internal CA is added without disabling trust or hostname validation', async () => {
  const guard = createGuard({ ...config, caFile: 'internal-ca.pem', proxy: 'http://proxy.internal:8080' }, { env, read: path => { assert.equal(path, 'internal-ca.pem'); return 'TEST_CA'; }, fetch: async (_, options) => {
    assert.ok(options.tls.ca.length > 1);
    assert.equal(options.tls.ca.at(-1), 'TEST_CA');
    assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.proxy, 'http://proxy.internal:8080');
    return new Response('ok');
  } });
  await guard('https://model.internal/v1/chat/completions', request);
});

test('invalid transports fail before any network access', () => {
  for (const baseUrl of ['file:///secret', 'ftp://internal/', 'https://user:password@internal/v1', 'https://internal/v1?key=x', 'https://internal/v1#fragment', 'http://internal/v1', 'http://127.evil/v1'])
    assert.throws(() => validateConfig({ ...config, baseUrl }));
  for (const baseUrl of ['http://localhost:11434/v1', 'http://127.0.0.1:11434/v1', 'http://[::1]:11434/v1'])
    assert.doesNotThrow(() => validateConfig({ ...config, baseUrl }));
  assert.doesNotThrow(() => validateConfig({ ...config, baseUrl: 'http://internal/v1', allowHttp: true }));
  for (const proxy of ['socks5://internal:1080', 'http://user:secret@internal/', 'http://internal/path'])
    assert.throws(() => createGuard({ ...config, proxy }));
});
