import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import extension, { collectCase, openCase, exportReport, runCollector, collectors, groups } from '../src/ir/triage.mjs';

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.build/triage-tests-'));
const fake = async () => ({ stdout: Buffer.from('pid 10 parent 1\nsuspicious-looking is not a verdict\n'), stderr: Buffer.alloc(0), status: 'ok', exitCode: 0, signal: null, error: null });
const makeCase = () => collectCase(scratch, 'IR-2026', ['processes'], fake);
const valid = () => ({ summary: 'Process snapshot only.', findings: [{ title: 'A process was observed', kind: 'observation', confidence: 'high', explanation: 'PID 10 appears in the captured output.', evidence: [{ artifact: 'evidence/processes.stdout.txt', startLine: 1, endLine: 1 }] }], unansweredQuestions: ['Other persistence mechanisms were not collected.'], recommendedNextSteps: ['Review on a trusted workstation.'] });
const sha256 = value => createHash('sha256').update(value).digest('hex');
function replaceEvidence(sample, text) {
  const index = JSON.parse(fs.readFileSync(path.join(sample.root, 'case.json')));
  fs.writeFileSync(path.join(sample.root, index.artifacts[0].path), text);
  index.artifacts[0].bytes = Buffer.byteLength(text); index.artifacts[0].sha256 = sha256(text);
  const data = JSON.stringify(index, null, 2) + '\n';
  fs.writeFileSync(path.join(sample.root, 'case.json'), data);
  fs.writeFileSync(path.join(sample.root, 'SHA256SUMS'), [...index.artifacts.map(a => `${a.sha256}  ${a.path}`), ...Object.entries(index.supportingFiles).map(([file, hash]) => `${hash}  ${file}`), `${sha256(data)}  case.json`].join('\n') + '\n');
}
function extensionFixture() {
  const commands = new Map(), events = new Map(), emitted = [], sent = [];
  const pi = { registerCommand: (name, cmd) => commands.set(name, cmd.handler), on: (name, handler) => events.set(name, handler), events: { emit: name => emitted.push(name) }, setActiveTools() {}, sendUserMessage: message => sent.push(message) };
  extension(pi);
  const ctx = { hasUI: true, cwd: scratch, model: { provider: 'local-test', id: 'fake-model' }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) }, waitForIdle: async () => {}, ui: { notify() {}, confirm: async () => true } };
  return { commands, events, emitted, sent, ctx, pi };
}

test('case export preserves raw bytes, bounded command audit, failures and UTC metadata', async () => {
  const result = await collectCase(scratch, 'Denied collection', ['logons'], async () => ({ ...await fake(), status: 'error', exitCode: 1, stderr: Buffer.from('access denied') }));
  const { index } = openCase(result.root);
  assert.equal(index.label, 'Denied collection');
  assert.match(index.startedUtc, /Z$/);
  assert.ok(index.hostname && index.operator && index.collectorVersion);
  const audit = JSON.parse(fs.readFileSync(path.join(result.root, 'audit.json')));
  assert.equal(audit[0].status, 'error');
  assert.equal(audit[0].timeoutMs, 30000);
  assert.equal(audit[0].args.at(-1), collectors().logons.args.at(-1));
  assert.match(fs.readFileSync(path.join(result.root, 'collection-report.md'), 'utf8'), /never evidence that a host is clean/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(result.root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(result.root, 'case.json')).mode & 0o777, 0o600);
  }
});

test('transferred cases open without recollecting from analyst host', async () => {
  const result = await makeCase();
  const destination = path.join(scratch, 'transferred-' + path.basename(result.root));
  fs.cpSync(result.root, destination, { recursive: true });
  assert.equal(openCase(destination).index.id, result.index.id);
});

test('evidence, metadata, supporting files and manifest tampering are rejected', async () => {
  for (const file of ['evidence/processes.stdout.txt', 'case.json', 'audit.json', 'SHA256SUMS']) {
    const result = await makeCase();
    fs.appendFileSync(path.join(result.root, file), ' ');
    assert.throws(() => openCase(result.root), /mismatch/);
  }
});

test('unsafe artifact paths, symlinks, and invalid labels are rejected', async () => {
  await assert.rejects(collectCase(scratch, 'bad\nlabel', ['host'], fake), /label/);
  await assert.rejects(collectCase(scratch, '', ['unknown'], fake), /collector/);
  const result = await makeCase();
  const index = result.index;
  index.artifacts[0].path = '../../secret.txt';
  fs.writeFileSync(path.join(result.root, 'case.json'), JSON.stringify(index));
  assert.throws(() => openCase(result.root), /Invalid artifact/);
  const target = path.join(scratch, 'linked');
  fs.symlinkSync(result.root, target, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => openCase(target), /Symlink/);
});

test('reports validate evidence hashes, schema and real nonempty source line ranges', async () => {
  const result = await makeCase();
  const output = exportReport(result.root, JSON.stringify(valid()));
  assert.match(fs.readFileSync(output, 'utf8'), /processes.stdout.txt:1-1/);
  assert.ok(fs.existsSync(output.replace(/\.md$/, '.sha256')));
  for (const mutate of [
    v => { v.findings[0].evidence = []; },
    v => { v.findings[0].evidence[0].artifact = '../case.json'; },
    v => { v.findings[0].evidence[0].endLine = 3; },
    v => { v.findings[0].evidence[0].startLine = 0; },
    v => { v.findings[0].kind = 'proven-malware'; },
    v => { v.findings[0].confidence = 'certain'; },
  ]) {
    const answer = valid(); mutate(answer);
    assert.throws(() => exportReport(result.root, JSON.stringify(answer)));
  }
  fs.appendFileSync(path.join(result.root, 'evidence/processes.stdout.txt'), 'changed');
  assert.throws(() => exportReport(result.root, JSON.stringify(valid())), /hash mismatch/);
});

test('reports bind the source manifest and retain analysis request provenance', async () => {
  const sample = await makeCase();
  const request = { id: 'synthetic-request', provider: 'local-test', model: 'fake-model', evidenceManifestSha256: openCase(sample.root).manifestSha256 };
  const report = exportReport(sample.root, JSON.stringify(valid()), request);
  const result = JSON.parse(fs.readFileSync(report.replace(/\.md$/, '.json')));
  assert.deepEqual(result.analysisRequest, request);
  assert.equal(result.evidenceManifestSha256, request.evidenceManifestSha256);
  replaceEvidence(sample, 'PID 20\n');
  assert.doesNotThrow(() => openCase(sample.root), 'the replacement is internally consistent');
  assert.throws(() => exportReport(sample.root, JSON.stringify(valid()), request), /Case changed since analysis/);
});

test('case verification rejects FIFO artifacts without blocking', { skip: process.platform === 'win32' }, async () => {
  const sample = await makeCase();
  const file = path.join(sample.root, sample.index.artifacts[0].path);
  fs.unlinkSync(file);
  assert.equal(spawnSync('mkfifo', [file]).status, 0);
  const check = spawnSync(process.execPath, ['--input-type=module', '-e', `import { openCase } from './src/ir/triage.mjs'; try { openCase(process.argv[1]); process.exitCode = 1; } catch (error) { if (!/Invalid case file/.test(error.message)) throw error; }`, sample.root], { cwd: root, timeout: 3000 });
  assert.equal(check.error, undefined, 'special-file validation must not hang');
  assert.equal(check.status, 0, check.stderr?.toString());
});

test('analysis rejects session changes and replaced evidence during disclosure', async () => {
  for (const change of ['session', 'evidence']) {
    const sample = await makeCase(), f = extensionFixture();
    await f.commands.get('case')(sample.root, f.ctx);
    f.ctx.ui.confirm = async () => { if (change === 'session') f.events.get('session_start')(); else replaceEvidence(sample, 'PID 20\n'); return true; };
    await assert.rejects(f.commands.get('analyze')('', f.ctx), change === 'session' ? /session or active case changed/ : /Case changed during disclosure/);
    assert.equal(f.sent.length, 0);
    assert.ok(!f.emitted.includes('pi-response:case-analysis'));
    await f.commands.get('case')(sample.root, f.ctx);
    f.ctx.ui.confirm = async () => true;
    await f.commands.get('analyze')('', f.ctx);
    assert.equal(f.sent.length, 1, 'a failed disclosure must not wedge command state');
  }
});

test('analysis tools stay in the active case and omitted search paths use that case', async () => {
  const sample = await makeCase(), f = extensionFixture();
  await f.commands.get('case')(sample.root, f.ctx);
  await f.commands.get('analyze')('', f.ctx);
  const guard = f.events.get('tool_call');
  for (const input of [{ path: path.join(scratch, 'outside.txt') }, { path: path.relative(scratch, path.join(sample.root, '..', 'outside.txt')) }, { path: `@${sample.root}` }, { path: 'file:///outside.txt' }, { path: '~/outside.txt' }]) {
    assert.equal(guard({ toolName: 'read', input }, f.ctx).block, true);
  }
  assert.equal(guard({ toolName: 'powershell', input: {} }, f.ctx).block, true);
  for (const toolName of ['grep', 'find', 'ls']) {
    const event = { toolName, input: {} };
    assert.equal(guard(event, f.ctx), undefined);
    assert.equal(event.input.path, sample.root);
  }
  const event = { toolName: 'read', input: { path: path.relative(scratch, path.join(sample.root, sample.index.artifacts[0].path)) } };
  assert.equal(guard(event, f.ctx), undefined);
  assert.equal(event.input.path, path.join(sample.root, sample.index.artifacts[0].path));
  f.events.get('agent_end')({ messages: [] });
  assert.equal(guard({ toolName: 'read', input: { path: path.join(scratch, 'outside.txt') } }, f.ctx), undefined, 'the guard ends with analysis');
});

test('synchronous prompt submission errors release analysis and web state', async () => {
  const sample = await makeCase(), f = extensionFixture();
  await f.commands.get('case')(sample.root, f.ctx);
  f.pi.sendUserMessage = () => { throw new Error('synthetic submission failure'); };
  await assert.rejects(f.commands.get('analyze')('', f.ctx), /synthetic submission failure/);
  assert.ok(f.emitted.includes('pi-response:case-analysis-end'));
  await f.commands.get('case')(sample.root, f.ctx);
});

test('collector enforces timeout/output bounds, reports missing commands and strips credentials', async () => {
  const spec = code => ({ executable: process.execPath, args: ['-e', code] });
  const timeout = await runCollector(spec('setInterval(()=>{},1000)'), { timeout: 50 });
  assert.equal(timeout.status, 'timeout');
  const excess = await runCollector(spec('process.stdout.write("a".repeat(100000))'), { limit: 100 });
  assert.equal(excess.status, 'output-limit');
  assert.equal(excess.stdout.length, 100);
  const missing = await runCollector({ executable: path.join(scratch, 'missing-executable'), args: [] });
  assert.equal(missing.status, 'unavailable');
  process.env.IR_TEST_SECRET = 'must-not-reach-collector';
  const clean = await runCollector(spec('console.log(process.env.IR_TEST_SECRET || "absent")'));
  assert.equal(clean.stdout.toString().trim(), 'absent');
  delete process.env.IR_TEST_SECRET;
});

test('reviewed collector definitions contain every advertised platform group', () => {
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(Object.keys(collectors(platform)), groups);
    for (const spec of Object.values(collectors(platform))) assert.ok(path.isAbsolute(spec.executable) || platform === 'win32');
  }
  assert.throws(() => collectors('darwin'), /Windows and Linux/);
});

test('extension separates collection, consent, analysis and citation-validated report export', async () => {
  const commands = new Map(), events = new Map();
  const sent = [], tools = [], notices = [];
  extension({ registerCommand: (name, cmd) => commands.set(name, cmd.handler), on: (name, handler) => events.set(name, handler), setActiveTools: names => tools.push(names), sendUserMessage: message => sent.push(message) });
  const sample = await makeCase();
  const ctx = { hasUI: true, cwd: scratch, model: { provider: 'local-test', id: 'fake-model' }, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true }) }, waitForIdle: async () => {}, ui: { notify: message => notices.push(message), confirm: async () => false } };
  await commands.get('case')(sample.root, ctx);
  assert.equal(sent.length, 0);
  await commands.get('analyze')('', ctx);
  assert.equal(sent.length, 0, 'declining disclosure must prevent the model request');
  ctx.ui.confirm = async () => true;
  ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false });
  await assert.rejects(commands.get('analyze')('', ctx), /authentication unavailable/);
  assert.equal(sent.length, 0);
  ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true });
  await commands.get('analyze')('', ctx);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Do not collect from this computer/);
  assert.deepEqual(tools[0], ['read', 'grep', 'find', 'ls']);
  await assert.rejects(commands.get('case')(sample.root, ctx), /Wait/);
  events.get('agent_end')({ messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(valid()) }] }] });
  await commands.get('report')('', ctx);
  assert.ok(notices.some(s => s.includes('Report exported:')));
  const request = fs.readdirSync(sample.root).find(s => s.startsWith('analysis-request-'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(sample.root, request))).model, 'fake-model');
});
