import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import extension, { collectCase, openCase, exportReport, runCollector, collectors, groups } from '../src/ir/triage.mjs';

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, '.build'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.build/triage-tests-'));
const fake = async () => ({ stdout: Buffer.from('pid 10 parent 1\nsuspicious-looking is not a verdict\n'), stderr: Buffer.alloc(0), status: 'ok', exitCode: 0, signal: null, error: null });
const makeCase = () => collectCase(scratch, 'IR-2026', ['processes'], fake);
const valid = () => ({ summary: 'Process snapshot only.', findings: [{ title: 'A process was observed', kind: 'observation', confidence: 'high', explanation: 'PID 10 appears in the captured output.', evidence: [{ artifact: 'evidence/processes.stdout.txt', startLine: 1, endLine: 1 }] }], unansweredQuestions: ['Other persistence mechanisms were not collected.'], recommendedNextSteps: ['Review on a trusted workstation.'] });

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
