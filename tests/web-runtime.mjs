// Test the shipped executable against fake Ollama model/search/fetch endpoints only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const home = fs.mkdtempSync(path.join(root, '.build/web-runtime-'));
fs.mkdirSync(path.join(home, 'agent'));
let scenario = 'happy', turn = 0, serverError, slowReceived;
const slow = new Promise(resolve => { slowReceived = resolve; });
const requests = [];
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(req.headers.authorization, 'Bearer local-test');
    requests.push({ url: req.url, body });
    if (req.url === '/api/web_search') {
      assert.equal(body.max_results, 10);
      if (body.query === 'RATE_LIMIT_TEST') { res.writeHead(429).end('synthetic rate limit'); return; }
      if (body.query === 'CANCEL_TEST') { slowReceived(); return; }
      assert.equal(body.query, 'public synthetic advisory');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results: [{ title: 'Synthetic advisory', url: 'https://example.com/advisory', content: 'PUBLIC_SEARCH_RESULT' }] }));
      return;
    }
    if (req.url === '/api/web_fetch') {
      assert.ok(['https://example.com/advisory', 'https://example.com/reference'].includes(body.url));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ title: 'Synthetic reference', content: 'PUBLIC_FETCH_RESULT', links: [] }));
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    const active = body.tools.map(t => t.function.name);
    const shouldHaveWeb = scenario !== 'off' && !(scenario === 'cancel' && turn > 0);
    assert.equal(active.includes('web_search'), shouldHaveWeb, JSON.stringify({ scenario, turn, active, stderr }));
    assert.equal(active.includes('url_context'), shouldHaveWeb);
    let tool;
    const index = turn++;
    if (index === 0 && scenario !== 'off') tool = ['web_search', { query: scenario === 'rate' ? 'RATE_LIMIT_TEST' : scenario === 'cancel' ? 'CANCEL_TEST' : 'public synthetic advisory', ...(scenario === 'happy' ? { urls: ['https://example.com/advisory'] } : {}) }];
    if (index === 1 && scenario === 'happy') {
      assert.match(raw, /PUBLIC_SEARCH_RESULT/); assert.match(raw, /https:\/\/example.com\/advisory/);
      tool = ['url_context', { query: 'Read public reference', urls: ['https://example.com/reference'] }];
    }
    if (index === 2 && scenario === 'happy') assert.match(raw, /PUBLIC_FETCH_RESULT/);
    if (index === 1 && scenario === 'rate') assert.match(raw, /429/);
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `${scenario}-${index}`, type: 'function', function: { name: tool[0], arguments: JSON.stringify(tool[1]) } }] } : { role: 'assistant', content: `WEB_${scenario.toUpperCase()}_OK` };
    const event = (value, finish_reason = null) => JSON.stringify({ id: 'web-test', object: 'chat.completion.chunk', created: 0, model: 'portable-test', choices: [{ index: 0, delta: value, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${event(delta)}\n\ndata: ${event({}, tool ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
  } catch (error) { serverError = error; res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const preset = JSON.parse(fs.readFileSync(path.join(root, 'config/models.json')));
preset.providers['ollama-cloud'].baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
fs.writeFileSync(path.join(home, 'agent/models.json'), JSON.stringify(preset));
fs.writeFileSync(path.join(home, 'agent/ollama-cloud.key'), 'local-test');
const child = spawn(path.join(root, 'dist', process.platform === 'win32' ? 'pi-portable.exe' : 'pi-portable-linux-x64'), ['--mode', 'rpc', '--no-session'], { env: { ...process.env, PI_PORTABLE_HOME: home, OLLAMA_API_KEY: '', PI_WEB_SEARCH_CONFIG: path.join(home, 'agent/web-search.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', stderr = '', failure, consent = true, sequence = 0;
const events = [], waiters = [];
const send = value => child.stdin.write(JSON.stringify(value) + '\n');
const wait = (predicate, start = 0) => new Promise((resolve, reject) => {
  const old = events.slice(start).find(predicate);
  if (old) { resolve(old); return; }
  const waiter = { predicate, resolve, timer: setTimeout(() => reject(new Error(`RPC timeout. ${stderr}\n${JSON.stringify(events).slice(-3500)}`)), 60000) };
  waiters.push(waiter);
});
child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
    if (!line) continue;
    try {
      const event = JSON.parse(line); events.push(event);
      if (event.type === 'extension_ui_request' && event.method === 'confirm') send({ type: 'extension_ui_response', id: event.id, confirmed: consent });
      for (const waiter of [...waiters]) if (waiter.predicate(event)) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event); }
    } catch (error) { failure = error; }
  }
});
child.stderr.on('data', chunk => { stderr += chunk; });
child.on('error', error => { failure = error; });
const prompt = async message => {
  const id = `prompt-${++sequence}`;
  send({ type: 'prompt', id, message });
  const response = await wait(e => e.type === 'response' && e.id === id);
  assert.ok(response.success, JSON.stringify(response));
};
const run = async name => {
  scenario = name; turn = 0;
  const start = events.length;
  await prompt(`Run the ${name} public research test.`);
  await wait(e => e.type === 'agent_end', start);
  if (serverError) throw serverError;
  assert.ok(JSON.stringify(events.slice(start)).includes(`WEB_${name.toUpperCase()}_OK`));
};
try {
  await prompt('/web status');
  assert.ok(events.some(e => e.message === 'Web research: off.'));
  consent = false; await prompt('/web on');
  assert.equal(requests.length, 0, 'declining must not contact any provider');
  consent = true; await prompt('/web on');
  await run('happy');
  assert.equal(requests.filter(r => r.url === '/api/web_search').length, 1);
  assert.equal(requests.filter(r => r.url === '/api/web_fetch').length, 2);
  await run('rate');
  scenario = 'cancel'; turn = 0;
  const start = events.length;
  const running = prompt('Run the cancellation test.');
  await slow;
  await prompt('/web off');
  await running;
  await wait(e => e.type === 'agent_end', start);
  if (serverError) throw serverError;
  await run('off');
  await prompt('/web on');
  const collectionStart = events.length;
  const requestCount = requests.length;
  await prompt('/processes web-integration-test');
  await prompt('/web status');
  assert.equal(requests.length, requestCount, 'collection must not trigger searches or inference');
  assert.ok(events.slice(collectionStart).some(e => e.message === 'Web research: off.'));
  if (failure) throw failure;
  console.log('PASS: bundled pi-web-search uses saved Ollama credentials, respects disclosure denial, searches/fetches with source URLs, handles 429 responses, cancels in-flight work and turns off for collection.');
} finally {
  child.stdin.end(); child.kill();
  for (const waiter of waiters) clearTimeout(waiter.timer);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
