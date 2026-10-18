import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(root, '.build/runtime '));
mkdirSync(join(scratch, '.git'));
const exe = join(root, 'dist/pi-portable.exe');
const secret = 'synthetic-runtime-secret';
const systemPath = [join(process.env.SystemRoot, 'System32'), process.env.SystemRoot, join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';');
const listen = server => new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const close = server => { server.closeAllConnections?.(); return new Promise(resolveClose => server.close(resolveClose)); };
function launch(home, config, args = [], extraEnv = {}) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'portable.json'), JSON.stringify({ model: 'local-coder', auth: 'bearer', proxy: 'direct', ...config }));
  return new Promise((resolveExit, reject) => {
    const child = spawn(exe, ['--project', scratch, '--project-id', 'runtime-tests', ...args], {
      cwd: scratch, env: { ...process.env, PI_PORTABLE_HOME: home, PI_PORTABLE_API_KEY: secret, PATH: systemPath,
        HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '', no_proxy: '', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Runtime timed out: ${stdout}\n${stderr}`)); }, 45000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => { clearTimeout(timer); resolveExit({ status, stdout, stderr }); });
  });
}
function sse(res, delta, finish = 'stop') {
  const chunk = (value, finish_reason = null) => ({ id: 'local-completion', object: 'chat.completion.chunk', created: 0, model: 'local-coder', choices: [{ index: 0, delta: value, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
  res.end(`data: ${JSON.stringify(chunk(delta))}\n\ndata: ${JSON.stringify(chunk({}, finish))}\n\ndata: [DONE]\n\n`);
}
async function body(req) { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); }
function allFiles(dir) { return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? allFiles(path) : [path]; }); }

test('packaged coding agent reads, searches, edits, writes and runs native PowerShell with system-only PATH', async () => {
  writeFileSync(join(scratch, 'sample.txt'), 'OLD_MARKER\n');
  writeFileSync(join(scratch, 'AGENTS.md'), 'UNTRUSTED_PROJECT_INSTRUCTION');
  mkdirSync(join(scratch, '.pi/extensions'), { recursive: true });
  writeFileSync(join(scratch, '.pi/extensions/hostile.ts'), 'throw new Error("HOSTILE_EXTENSION_LOADED")');
  const calls = [
    ['read', { path: 'sample.txt' }, 'OLD_MARKER'],
    ['grep', { pattern: 'OLD_MARKER', path: 'sample.txt' }, 'OLD_MARKER'],
    ['find', { pattern: '*.txt', path: '.' }, 'sample.txt'],
    ['ls', { path: '.' }, 'sample.txt'],
    ['edit', { path: 'sample.txt', oldText: 'OLD_MARKER', newText: 'NEW_MARKER' }, null],
    ['write', { path: 'created.txt', content: 'CREATED_MARKER\n' }, null],
    ['powershell', { command: "[Console]::WriteLine('POWERSHELL_MARKER')" }, 'POWERSHELL_MARKER'],
  ];
  let count = 0, serverError;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, `Bearer ${secret}`);
      const payload = await body(req);
      assert.equal(payload.model, 'local-coder');
      assert.ok(!JSON.stringify(payload).includes('UNTRUSTED_PROJECT_INSTRUCTION'));
      assert.deepEqual(payload.tools.map(tool => tool.function.name).sort(), calls.map(call => call[0]).sort());
      const results = payload.messages.filter(message => message.role === 'tool');
      for (let i = 0; i < results.length; i++) if (calls[i][2]) assert.ok(JSON.stringify(results[i]).includes(calls[i][2]), JSON.stringify(results[i]));
      const call = calls[count++];
      if (call) sse(res, { role: 'assistant', tool_calls: [{ index: 0, id: `call_${count}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] }, 'tool_calls');
      else sse(res, { role: 'assistant', content: 'CODING_SMOKE_OK' });
    } catch (error) { serverError = error; res.writeHead(500).end('test assertion failed'); }
  });
  await listen(server);
  const home = join(scratch, 'coding-home');
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
  try {
    const result = await launch(home, config, ['--profile', 'full', '--print', 'Run synthetic tool tests.']);
    if (serverError) throw serverError;
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /CODING_SMOKE_OK/);
    assert.equal(readFileSync(join(scratch, 'sample.txt'), 'utf8'), 'NEW_MARKER\n');
    assert.equal(readFileSync(join(scratch, 'created.txt'), 'utf8'), 'CREATED_MARKER\n');
    assert.equal(count, calls.length + 1);
    assert.ok(allFiles(join(home, 'sessions')).length > 0);
    // Reopen the same session with a narrower profile; old tool state must not grant writes.
    server.removeAllListeners('request');
    server.on('request', async (req, res) => {
      try {
        const payload = await body(req);
        assert.deepEqual(payload.tools.map(tool => tool.function.name).sort(), ['read', 'grep', 'find', 'ls'].sort());
        sse(res, { role: 'assistant', content: 'REVIEW_RESUME_OK' });
      } catch (error) { serverError = error; res.writeHead(500).end('test assertion failed'); }
    });
    const resumed = await launch(home, config, ['--profile', 'review', '--continue', '--print', 'Review only.']);
    if (serverError) throw serverError;
    assert.match(resumed.stdout, /REVIEW_RESUME_OK/, resumed.stdout + resumed.stderr);
    const movedProject = join(scratch, 'relocated project'); mkdirSync(join(movedProject, '.git'), { recursive: true });
    const previous = readdirSync(join(home, 'sessions/runtime-tests')).find(name => name.endsWith('.jsonl'));
    const relocated = await launch(home, config, ['--project', movedProject, '--profile', 'review', '--fork-session', previous, '--print', 'Continue in the relocated project.']);
    if (serverError) throw serverError;
    assert.equal(relocated.status, 0, relocated.stdout + relocated.stderr);
    assert.match(relocated.stdout, /REVIEW_RESUME_OK/);
    for (const file of allFiles(home).filter(path => !path.includes(`${join(home, 'runtime')}\\`)))
      assert.ok(!readFileSync(file).includes(Buffer.from(secret)), `Credential leaked to ${file}`);
  } finally { await close(server); }
});

// Fresh CA generated in the test cache; no certificate is installed into the machine store.
const openssl = process.env.OPENSSL ?? 'C:/Program Files/Git/usr/bin/openssl.exe';
function certs() {
  const dir = join(scratch, 'certs'); mkdirSync(dir);
  writeFileSync(join(dir, 'san.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  const run = args => { const result = spawnSync(openssl, args, { cwd: dir, encoding: 'utf8' }); assert.equal(result.status, 0, result.stdout + result.stderr); };
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Pi Portable Test CA']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost']);
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '2', '-extfile', 'san.cnf']);
  return { caFile: join(dir, 'ca.pem'), key: readFileSync(join(dir, 'server.key')), cert: readFileSync(join(dir, 'server.pem')) };
}

test('internal HTTPS, untrusted certificates, CONNECT proxy and NO_PROXY work in the shipped runtime', async () => {
  const tls = certs(); let requests = 0, proxyConnections = 0, serverError;
  const server = createHttpsServer(tls, async (req, res) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${secret}`); await body(req); requests++;
      sse(res, { role: 'assistant', content: 'INTERNAL_HTTPS_OK' });
    } catch (error) { serverError = error; res.writeHead(500).end('assertion failed'); }
  });
  await listen(server);
  const proxy = createServer((req, res) => res.writeHead(502).end());
  const sockets = new Set();
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('connect', (req, socket, head) => {
    proxyConnections++;
    const [host, port] = req.url.split(':');
    assert.equal(host, '127.0.0.1'); assert.equal(Number(port), server.address().port);
    const upstream = connect(Number(port), host, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  });
  await listen(proxy);
  const baseUrl = `https://127.0.0.1:${server.address().port}/v1`;
  try {
    const trusted = await launch(join(scratch, 'tls-good'), { baseUrl, caFile: tls.caFile }, ['--print', 'hello'], { HTTPS_PROXY: 'http://127.0.0.1:1' });
    assert.match(trusted.stdout, /INTERNAL_HTTPS_OK/, trusted.stdout + trusted.stderr);
    const bad = await launch(join(scratch, 'tls-bad'), { baseUrl }, ['--print', 'hello'], { NODE_TLS_REJECT_UNAUTHORIZED: '0' });
    assert.ok(!bad.stdout.includes('INTERNAL_HTTPS_OK')); assert.equal(requests, 1);
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    const proxied = await launch(join(scratch, 'tls-proxy'), { baseUrl, caFile: tls.caFile, proxy: proxyUrl }, ['--print', 'hello']);
    assert.match(proxied.stdout, /INTERNAL_HTTPS_OK/, proxied.stdout + proxied.stderr); assert.ok(proxyConnections > 0);
    const beforeEnvironment = proxyConnections;
    const environment = await launch(join(scratch, 'tls-proxy-env'), { baseUrl, caFile: tls.caFile, proxy: 'env' }, ['--print', 'hello'], { HTTPS_PROXY: proxyUrl });
    assert.match(environment.stdout, /INTERNAL_HTTPS_OK/, environment.stdout + environment.stderr); assert.ok(proxyConnections > beforeEnvironment);
    const beforeBypass = proxyConnections;
    const bypass = await launch(join(scratch, 'tls-bypass'), { baseUrl, caFile: tls.caFile, proxy: 'env' }, ['--print', 'hello'], { HTTPS_PROXY: proxyUrl, NO_PROXY: '127.0.0.1' });
    assert.match(bypass.stdout, /INTERNAL_HTTPS_OK/, bypass.stdout + bypass.stderr); assert.equal(proxyConnections, beforeBypass);
    if (serverError) throw serverError;
  } finally { for (const socket of sockets) socket.destroy(); await close(proxy); await close(server); }
});

test('packaged runtime blocks redirects and invalid transport policy before model requests', async () => {
  let escaped = 0, redirects = 0;
  const publicSink = createServer((req, res) => { escaped++; res.writeHead(500).end(); }); await listen(publicSink);
  const internal = createServer((req, res) => { redirects++; res.writeHead(307, { location: `http://127.0.0.1:${publicSink.address().port}/public` }).end(); }); await listen(internal);
  try {
    const result = await launch(join(scratch, 'redirects'), { baseUrl: `http://127.0.0.1:${internal.address().port}/v1` }, ['--print', 'hello']);
    assert.ok(redirects > 0, result.stdout + result.stderr); assert.equal(escaped, 0);
    assert.match(result.stdout + result.stderr, /blocked an endpoint redirect/);
    const count = redirects;
    const invalid = await launch(join(scratch, 'invalid-policy'), { baseUrl: `http://127.0.0.1:${internal.address().port}/v1`, proxy: 'socks5://internal:1080' }, ['--print', 'hello']);
    assert.equal(invalid.status, 1); assert.equal(redirects, count);
    assert.match(invalid.stderr, /transport policy is invalid/);
  } finally { await close(internal); await close(publicSink); }
});

test('offline version startup works when every inherited proxy is unreachable', async () => {
  const result = await launch(join(scratch, 'offline-start'), { baseUrl: 'https://unreachable.internal/v1' }, ['--version'], { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1' });
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /1\.3\.0/);
  let unexpectedRequests = 0;
  const sentinel = createServer((req, res) => { unexpectedRequests++; res.writeHead(500).end(); }); await listen(sentinel);
  try {
    const origin = `http://127.0.0.1:${sentinel.address().port}`;
    const startup = await launch(join(scratch, 'offline-rpc'), { baseUrl: `${origin}/v1`, proxy: 'env' }, ['--mode', 'rpc'], { HTTP_PROXY: origin, HTTPS_PROXY: origin, ALL_PROXY: origin });
    assert.equal(startup.status, 0, startup.stdout + startup.stderr);
    assert.equal(unexpectedRequests, 0, 'RPC startup must not probe the endpoint or use a proxy');
  } finally { await close(sentinel); }
});

test('packaged Ollama no-auth, Azure API keys and custom Responses endpoints', async () => {
  let serverError, count = 0;
  const server = createServer(async (req, res) => {
    try {
      const payload = await body(req); count++;
      if (req.url.startsWith('/openai/deployments/coder/')) {
        assert.equal(req.url, '/openai/deployments/coder/chat/completions?api-version=2024-10-21');
        assert.equal(req.headers['api-key'], secret); assert.equal(req.headers.authorization, undefined);
        assert.equal(payload.model, 'coder'); sse(res, { role: 'assistant', content: 'AZURE_OK' });
      } else if (req.url === '/v1/responses') {
        assert.equal(req.headers['x-company-token'], 'synthetic-custom-token'); assert.equal(req.headers.authorization, undefined);
        const item = { type: 'message', id: 'msg_local', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'CUSTOM_RESPONSES_OK', annotations: [] }] };
        const events = [
          { type: 'response.created', response: { id: 'resp_local' } },
          { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'CUSTOM_RESPONSES_OK' },
          { type: 'response.output_item.done', output_index: 0, item },
          { type: 'response.completed', response: { id: 'resp_local', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
        ];
        res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
        res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
      } else {
        assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, undefined);
        sse(res, { role: 'assistant', content: 'OLLAMA_OK' });
      }
    } catch (error) { serverError = error; res.writeHead(500).end('assertion failed'); }
  });
  await listen(server); const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const ollama = await launch(join(scratch, 'ollama'), { kind: 'ollama', baseUrl: `${origin}/v1`, auth: 'none' }, ['--print', 'hello']);
    assert.match(ollama.stdout, /OLLAMA_OK/, ollama.stdout + ollama.stderr);
    const azure = await launch(join(scratch, 'azure'), { kind: 'azure', baseUrl: `${origin}/openai/deployments/coder`, model: 'coder', auth: 'api-key', apiVersion: '2024-10-21' }, ['--print', 'hello']);
    assert.match(azure.stdout, /AZURE_OK/, azure.stdout + azure.stderr);
    const custom = await launch(join(scratch, 'custom'), { kind: 'custom', baseUrl: `${origin}/v1`, api: 'openai-responses', auth: 'none', headers: { 'X-Company-Token': '${COMPANY_TOKEN}' } }, ['--print', 'hello'], { COMPANY_TOKEN: 'synthetic-custom-token' });
    assert.match(custom.stdout, /CUSTOM_RESPONSES_OK/, custom.stdout + custom.stderr);
    if (serverError) throw serverError; assert.equal(count, 3);
  } finally { await close(server); }
});

test('review profile rejects a model attempting an undeclared write tool', async () => {
  const protectedFile = join(scratch, 'review-protected.txt'); writeFileSync(protectedFile, 'UNCHANGED');
  let calls = 0, serverError;
  const server = createServer(async (req, res) => {
    try {
      const payload = await body(req);
      assert.ok(!payload.tools.some(tool => tool.function.name === 'write'));
      if (calls++ === 0) sse(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'forbidden_write', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: 'review-protected.txt', content: 'CHANGED' }) } }] }, 'tool_calls');
      else {
        assert.ok(payload.messages.some(message => message.role === 'tool' && /not found|disabled|not available/i.test(JSON.stringify(message))));
        sse(res, { role: 'assistant', content: 'REVIEW_GUARD_OK' });
      }
    } catch (error) { serverError = error; res.writeHead(500).end('assertion failed'); }
  });
  await listen(server);
  try {
    const result = await launch(join(scratch, 'review-guard'), { baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, ['--profile', 'review', '--print', 'Read only.']);
    if (serverError) throw serverError;
    assert.match(result.stdout, /REVIEW_GUARD_OK/, result.stdout + result.stderr);
    assert.equal(readFileSync(protectedFile, 'utf8'), 'UNCHANGED'); assert.equal(calls, 2);
  } finally { await close(server); }
});
