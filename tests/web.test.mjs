import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebGuard, webScope } from '../src/web-network.mjs';

const config = { baseUrl: 'https://model.internal/v1', proxy: 'direct', headers: { 'X-Company-Token': '${SECRET}' }, web: { enabled: true } };
test('web transport is disabled by default and outside web tool scope', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return new Response('ok'); };
  await assert.rejects(createWebGuard(config, { fetch })('https://example.com'), /disabled/);
  await webScope.run(true, async () => {
    await assert.rejects(createWebGuard({ ...config, web: {} }, { fetch })('https://example.com'), /disabled/);
  });
  assert.equal(calls, 0);
});

test('search credentials stay on the chosen provider and model credentials never enter page requests', async () => {
  const guard = createWebGuard(config, { fetch: async (url, options) => {
    assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.redirect, 'manual');
    for (const name of ['authorization', 'api-key', 'cookie', 'x-company-token']) assert.equal(options.headers.has(name), false);
    assert.equal(options.headers.get('x-api-key'), url === 'https://api.exa.ai/search' ? 'synthetic-exa' : null);
    assert.equal(options.headers.has('x-subscription-token'), false);
    return new Response('ok');
  } });
  const headers = { authorization: 'Bearer model-secret', 'api-key': 'model-secret', 'X-Company-Token': 'company-secret', cookie: 'private', 'x-api-key': 'synthetic-exa', 'x-subscription-token': 'synthetic-brave' };
  await webScope.run(true, async () => {
    await guard('https://api.exa.ai/search', { method: 'POST', body: '{}', headers });
    await guard('https://example.com/article', { headers });
    await assert.rejects(guard('https://model.internal/v1/chat/completions'), /not permitted/);
    await assert.rejects(guard('file:///secret'), /not permitted/);
    await assert.rejects(guard('https://user:password@example.com'), /credentials|password|Request/i);
  });
});

test('content allowlist is checked again on redirects and Jina is an independent opt-in', async () => {
  let calls = 0;
  const guard = createWebGuard({ ...config, web: { enabled: true, allowedOrigins: ['https://docs.internal'] } }, { fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://unapproved.example/' } }); } });
  await webScope.run(true, async () => {
    await assert.rejects(guard('https://docs.internal/article'), /outside/);
    assert.equal(calls, 1);
    await assert.rejects(guard('https://unapproved.example/'), /outside/);
    await assert.rejects(guard('https://r.jina.ai/https://docs.internal/article'), /Jina/);
    assert.equal(calls, 1);
  });
});

test('internal search mirrors are explicit, retain proxy/CA configuration and cannot target the model', async () => {
  const guard = createWebGuard({ ...config, proxy: 'http://proxy.internal:8080', caFile: 'ca.pem', web: { enabled: true, endpoints: { exaMcp: 'https://search.internal/exa' } } }, { read: () => 'CUSTOM_CA', fetch: async (url, options) => {
    assert.equal(url, 'https://search.internal/exa'); assert.equal(options.proxy, 'http://proxy.internal:8080');
    assert.equal(options.tls.ca.at(-1), 'CUSTOM_CA'); return new Response('ok');
  } });
  await webScope.run(true, () => guard('https://mcp.exa.ai/mcp', { method: 'POST', body: '{}' }));
  assert.throws(() => createWebGuard({ ...config, web: { endpoints: { exaMcp: 'https://model.internal/search' } } }), /Invalid search/);
  assert.throws(() => createWebGuard({ ...config, web: { endpoints: { constructor: 'https://search.internal/' } } }), /Unknown search/);
});

test('async web scope does not unlock concurrent model/other requests', async () => {
  const guard = createWebGuard(config, { fetch: async () => new Response('ok') });
  const scoped = webScope.run(true, async () => { await Promise.resolve(); return guard('https://example.com'); });
  await assert.rejects(guard('https://example.com'), /disabled/);
  assert.equal((await scoped).status, 200);
});
