import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(root, '.build/web-runtime ')); mkdirSync(join(scratch, '.git'));
const systemPath = [join(process.env.SystemRoot, 'System32'), process.env.SystemRoot, join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';');
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done));
const close = server => { server.closeAllConnections(); return new Promise(done => server.close(done)); };
async function json(req) { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); }
function reply(res, delta, finish = 'stop') {
  const chunk = (value, finish_reason = null) => ({ id: 'local-web-test', object: 'chat.completion.chunk', created: 0, model: 'local-coder', choices: [{ index: 0, delta: value, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
  res.end(`data: ${JSON.stringify(chunk(delta))}\n\ndata: ${JSON.stringify(chunk({}, finish))}\n\ndata: [DONE]\n\n`);
}
function run(home, baseUrl, web, args, env = {}) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'portable.json'), JSON.stringify({ baseUrl, model: 'local-coder', auth: 'bearer', proxy: 'direct', web }));
  return new Promise((done, reject) => {
    const child = spawn(join(root, 'dist/pi-portable.exe'), ['--project', scratch, '--print', 'Run the synthetic web test.', ...args], {
      env: { ...process.env, PATH: systemPath, PI_PORTABLE_HOME: home, PI_PORTABLE_API_KEY: 'synthetic-model-secret', EXA_API_KEY: '', BRAVE_API_KEY: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(stdout + stderr || 'Web runtime timed out')); }, 45000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => { clearTimeout(timer); done({ status, stdout, stderr }); });
  });
}
function files(dir) { return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; }); }

test('single EXE bundles the requested package: offline default, Exa MCP/direct, Brave and real HTML extraction', async () => {
  let serverError, mode = 'off', step = 0;
  const requests = [];
  const webServer = createServer(async (req, res) => {
    try {
      requests.push(req.url); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['api-key'], undefined);
      if (req.url === '/mcp') {
        const request = await json(req); assert.equal(request.params.name, 'web_search_exa');
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { content: [{ type: 'text', text: `Title: Local Source\nURL: ${webOrigin}/article\nText: SEARCH_MCP_MARKER` }] } }));
      } else if (req.url === '/answer') {
        assert.equal(req.headers['x-api-key'], 'synthetic-exa-secret'); await json(req);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ answer: 'SEARCH_API_MARKER', citations: [{ title: 'Local Source', url: `${webOrigin}/article` }] }));
      } else if (req.url.startsWith('/brave?')) {
        assert.equal(req.headers['x-subscription-token'], 'synthetic-brave-secret');
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ web: { results: [{ title: 'Brave Source', url: `${webOrigin}/article`, description: 'BRAVE_MARKER' }] } }));
      } else if (req.url === '/article') {
        res.setHeader('content-type', 'text/html');
        res.end(`<html><head><title>Portable Web Test</title></head><body><main><article><h1>Local article</h1>${'<p>EXTRACTEDARTICLEMARKER This is a long local test article about portable coding agents and offline software packaging with trusted internal services.</p>'.repeat(15)}</article></main></body></html>`);
      } else throw new Error(`Unexpected web request ${req.url}`);
    } catch (error) { serverError = error; res.writeHead(500).end('test assertion failed'); }
  });
  await listen(webServer); const webOrigin = `http://127.0.0.1:${webServer.address().port}`;
  const modelServer = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer synthetic-model-secret');
      const payload = await json(req); const tools = payload.tools.map(tool => tool.function.name);
      if (mode === 'off') {
        assert.ok(!tools.includes('web_search')); assert.ok(!tools.includes('fetch_content'));
        reply(res, { role: 'assistant', content: 'DEFAULT_OFF_OK' }); return;
      }
      assert.deepEqual(tools.sort(), ['read', 'grep', 'find', 'ls', 'web_search', 'fetch_content'].sort());
      const call = step++;
      const results = payload.messages.filter(message => message.role === 'tool');
      if (call > 0) assert.ok(JSON.stringify(results[0]).includes(mode === 'mcp' ? 'SEARCH_MCP_MARKER' : mode === 'api' ? 'SEARCH_API_MARKER' : 'BRAVE_MARKER'), JSON.stringify(results));
      if (call === 0) reply(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'search', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'synthetic test' }) } }] }, 'tool_calls');
      else if (call === 1 && mode === 'mcp') reply(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'fetch', type: 'function', function: { name: 'fetch_content', arguments: JSON.stringify({ url: `${webOrigin}/article` }) } }] }, 'tool_calls');
      else {
        if (mode === 'mcp') assert.ok(JSON.stringify(results[1]).includes('EXTRACTEDARTICLEMARKER'), JSON.stringify(results));
        reply(res, { role: 'assistant', content: 'WEB_RUNTIME_OK' });
      }
    } catch (error) { serverError = error; res.writeHead(500).end('test assertion failed'); }
  });
  await listen(modelServer); const baseUrl = `http://127.0.0.1:${modelServer.address().port}/v1`;
  const web = { allowedOrigins: [webOrigin], endpoints: { exaMcp: `${webOrigin}/mcp`, exaAnswer: `${webOrigin}/answer`, exaSearch: `${webOrigin}/search`, brave: `${webOrigin}/brave` } };
  try {
    const disabled = await run(join(scratch, 'off'), baseUrl, web, []);
    if (serverError) throw serverError;
    assert.equal(disabled.status, 0, disabled.stdout + disabled.stderr); assert.match(disabled.stdout, /DEFAULT_OFF_OK/); assert.equal(requests.length, 0);
    const forcedOff = await run(join(scratch, 'forced-off'), baseUrl, { ...web, enabled: true }, ['--no-web']);
    if (serverError) throw serverError;
    assert.equal(forcedOff.status, 0, forcedOff.stdout + forcedOff.stderr); assert.match(forcedOff.stdout, /DEFAULT_OFF_OK/); assert.equal(requests.length, 0);
    for (const scenario of ['mcp', 'api', 'brave']) {
      mode = scenario; step = 0;
      const home = join(scratch, scenario);
      const env = scenario === 'api' ? { EXA_API_KEY: 'synthetic-exa-secret' } : scenario === 'brave' ? { BRAVE_API_KEY: 'synthetic-brave-secret' } : {};
      const result = await run(home, baseUrl, { ...web, provider: scenario === 'brave' ? 'brave' : 'auto' }, ['--web'], env);
      if (serverError) throw serverError;
      assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /WEB_RUNTIME_OK/);
      if (scenario === 'api') assert.equal(JSON.parse(readFileSync(join(home, 'web/exa-usage.json'), 'utf8')).count, 1);
      for (const file of files(home).filter(path => !path.includes(`${join(home, 'runtime')}\\`))) {
        const bytes = readFileSync(file);
        for (const secret of ['synthetic-exa-secret', 'synthetic-brave-secret', 'synthetic-model-secret']) assert.ok(!bytes.includes(Buffer.from(secret)), `Credential persisted in ${file}`);
      }
    }
    assert.equal(requests.filter(path => path === '/mcp').length, 1);
    assert.equal(requests.filter(path => path === '/answer').length, 1);
    assert.equal(requests.filter(path => path.startsWith('/brave?')).length, 1);
    assert.equal(requests.filter(path => path === '/article').length, 1);
  } finally { await close(modelServer); await close(webServer); }
});
