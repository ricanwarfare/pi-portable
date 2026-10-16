// Exercise the real bundled extension, RPC consent dialog, model tool call and report export.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import path from 'node:path';
import { collectCase } from '../src/ir/triage.mjs';

const root = path.resolve(import.meta.dirname, '..');
const home = fs.mkdtempSync(path.join(root, '.build/analysis-smoke-'));
fs.mkdirSync(path.join(home, 'agent'));
const sample = await collectCase(home, 'SYNTHETIC TEST', ['processes'], async () => ({ stdout: Buffer.from('SYNTHETIC_PROCESS 123\n'), stderr: Buffer.alloc(0), status: 'ok', exitCode: 0, signal: null, error: null }));
const outside = path.join(home, 'outside-secret.txt');
fs.writeFileSync(outside, 'SYNTHETIC_OUTSIDE_MUST_NOT_SEND');
const answer = { summary: 'Synthetic test only.', findings: [{ title: 'Process listed', kind: 'observation', confidence: 'high', explanation: 'The synthetic artifact lists process 123.', evidence: [{ artifact: 'evidence/processes.stdout.txt', startLine: 1, endLine: 1 }] }], unansweredQuestions: ['Synthetic evidence cannot establish compromise.'], recommendedNextSteps: ['Human review.'] };
let requests = 0, serverError;
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(req.headers.authorization, 'Bearer local-test');
    assert.deepEqual(body.tools.map(t => t.function.name).sort(), ['find', 'grep', 'ls', 'read']);
    assert.match(raw, /Do not collect from this computer/);
    assert.ok(!raw.includes('SYNTHETIC_OUTSIDE_MUST_NOT_SEND'), 'outside-case file contents must never reach the provider');
    const index = requests++;
    if (index === 1) assert.match(raw, /Analysis tools must stay inside the active case folder/);
    if (index >= 2) assert.match(raw, /SYNTHETIC_PROCESS 123/, 'grep with an omitted path must search the active case');
    const call = index === 0 ? ['read', { path: outside }] : index === 1 ? ['grep', { pattern: 'SYNTHETIC_PROCESS' }] : index === 2 ? ['read', { path: path.relative(root, path.join(sample.root, 'evidence/processes.stdout.txt')) }] : null;
    const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: `case-inspection-${index}`, type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } : { role: 'assistant', content: JSON.stringify(answer) };
    const event = (value, finish_reason = null) => JSON.stringify({ id: 'analysis-test', object: 'chat.completion.chunk', created: 0, model: 'portable-test', choices: [{ index: 0, delta: value, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${event(delta)}\n\ndata: ${event({}, call ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
  } catch (error) { serverError = error; res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const preset = JSON.parse(fs.readFileSync(path.join(root, 'config/models.json')));
preset.providers['ollama-cloud'].baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
fs.writeFileSync(path.join(home, 'agent/models.json'), JSON.stringify(preset));
fs.writeFileSync(path.join(home, 'agent/ollama-cloud.key'), 'local-test');
const child = spawn(path.join(root, 'dist', process.platform === 'win32' ? 'pi-response.exe' : 'pi-response-linux-x64'), ['--mode', 'rpc', '--no-session'], { env: { ...process.env, PI_RESPONSE_HOME: home, OLLAMA_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', stderr = '', failure;
const events = [], waiters = [];
const send = value => child.stdin.write(JSON.stringify(value) + '\n');
const dispatch = event => {
  events.push(event);
  for (const waiter of [...waiters]) if (waiter.predicate(event)) { clearTimeout(waiter.timer); waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event); }
};
const wait = predicate => new Promise((resolve, reject) => {
  const old = events.find(predicate);
  if (old) { resolve(old); return; }
  const waiter = { predicate, resolve, timer: setTimeout(() => reject(new Error(`RPC timeout. ${stderr}\n${JSON.stringify(events).slice(-4000)}`)), 60000) };
  waiters.push(waiter);
});
child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
    if (!line) continue;
    try { dispatch(JSON.parse(line)); } catch (error) { failure = new Error(`Invalid RPC output: ${line}: ${error}`); }
  }
});
child.stderr.on('data', chunk => { stderr += chunk; });
child.on('error', error => { failure = error; });
const prompt = async (id, message) => {
  send({ type: 'prompt', id, message });
  const response = await wait(e => e.type === 'response' && e.id === id);
  assert.ok(response.success, JSON.stringify(response));
};
try {
  await prompt('open-case', `/case ${sample.root}`);
  send({ type: 'prompt', id: 'decline', message: '/analyze' });
  const first = await wait(e => e.type === 'extension_ui_request' && e.method === 'confirm');
  assert.match(first.message, /sensitive case evidence/);
  send({ type: 'extension_ui_response', id: first.id, confirmed: false });
  await wait(e => e.type === 'response' && e.id === 'decline');
  assert.equal(requests, 0);
  send({ type: 'prompt', id: 'enable-web', message: '/web on' });
  const webDisclosure = await wait(e => e.type === 'extension_ui_request' && e.method === 'confirm' && e.title === 'Enable public web research?');
  send({ type: 'extension_ui_response', id: webDisclosure.id, confirmed: true });
  await wait(e => e.type === 'response' && e.id === 'enable-web');
  send({ type: 'prompt', id: 'accept', message: '/analyze' });
  const second = await wait(e => e.type === 'extension_ui_request' && e.method === 'confirm' && e.title === first.title && e.id !== first.id);
  send({ type: 'extension_ui_response', id: second.id, confirmed: true });
  await wait(e => e.type === 'agent_end');
  if (serverError) throw serverError;
  assert.equal(requests, 4);
  await prompt('report', '/report');
  await wait(e => e.type === 'extension_ui_request' && e.method === 'notify' && e.message.includes('Report exported:'));
  const report = fs.readdirSync(sample.root).find(name => /^analysis-.*\.md$/.test(name));
  assert.ok(report);
  assert.match(fs.readFileSync(path.join(sample.root, report), 'utf8'), /processes.stdout.txt:1-1/);
  const exported = JSON.parse(fs.readFileSync(path.join(sample.root, report.replace(/\.md$/, '.json'))));
  assert.equal(exported.analysisRequest.provider, 'ollama-cloud');
  assert.equal(exported.analysisRequest.model, preset.providers['ollama-cloud'].models[0].id);
  assert.equal(exported.analysisRequest.evidenceManifestSha256, exported.evidenceManifestSha256);
  await prompt('web-status', '/web status');
  assert.ok(events.some(e => e.type === 'extension_ui_request' && e.message === 'Web research: off.'));
  if (failure) throw failure;
  console.log('PASS: real bundled IR workflow verifies case, respects disclosure denial, blocks outside-case reads, scopes omitted search paths, reads relative evidence paths and exports a report bound to model/request/source provenance.');
} finally {
  child.stdin.end();
  child.kill();
  for (const waiter of waiters) clearTimeout(waiter.timer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
