import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { configureWeb } from '../src/web/gate.mjs';

function fixture(executor) {
  const tools = new Map(), commands = new Map(), hooks = new Map(), bus = new Map();
  let active = ['read', 'grep', 'find', 'ls'];
  const calls = [], notices = [];
  const execute = async (...args) => { calls.push(args); return executor ? executor(...args) : { content: [{ type: 'text', text: 'test result' }] }; };
  const pi = { registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, cmd) => commands.set(name, cmd.handler), on: (name, fn) => hooks.set(name, fn), events: { on: (name, fn) => bus.set(name, fn) }, getActiveTools: () => active, setActiveTools: names => { active = names; }, getThinkingLevel: () => 'medium' };
  configureWeb(pi, { WebSearchSchema: {}, UrlContextSchema: {}, getProviderKind: model => model.kind, webSearch: execute, urlContext: execute });
  const ctx = { hasUI: true, model: { kind: 'ollama' }, waitForIdle: async () => {}, ui: { notify: message => notices.push(message), confirm: async () => true } };
  return { pi, tools, hooks, bus, calls, ctx, notices, active: () => active, web: choice => commands.get('web')(choice, ctx) };
}

test('web is inactive by default and execution is blocked even when invoked directly', async () => {
  const f = fixture();
  assert.equal(f.tools.get('web_search').defaultActive, false);
  assert.equal((await f.tools.get('web_search').execute('1', { query: 'public advisory' }, undefined, undefined, f.ctx)).isError, true);
  assert.equal(f.calls.length, 0);
  f.ctx.ui.confirm = async () => false;
  await f.web('on');
  assert.deepEqual(f.active(), ['read', 'grep', 'find', 'ls']);
});

test('consent enables tools, preserves other tools, and model changes scope URL retrieval', async () => {
  const f = fixture();
  await f.web('on');
  assert.deepEqual(f.active(), ['read', 'grep', 'find', 'ls', 'web_search', 'url_context']);
  await f.tools.get('web_search').execute('1', { query: 'public advisory' }, undefined, undefined, f.ctx);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][5], 'medium');
  f.hooks.get('model_select')({ model: { kind: 'openai' } });
  assert.ok(!f.active().includes('url_context'));
  f.hooks.get('model_select')({ model: { kind: 'ollama' } });
  assert.ok(f.active().includes('url_context'));
  await f.web('off');
  assert.deepEqual(f.active(), ['read', 'grep', 'find', 'ls']);
});

test('sessions, collection and analysis disable web without automatic restoration', async () => {
  const f = fixture();
  await f.web('on');
  f.bus.get('pi-response:collection-start')();
  await assert.rejects(f.web('on'), /stays off/);
  assert.ok(!f.active().includes('web_search'));
  f.bus.get('pi-response:collection-end')();
  await f.web('on');
  f.bus.get('pi-response:case-analysis')();
  await assert.rejects(f.web('on'), /stays off/);
  f.hooks.get('agent_end')();
  assert.ok(!f.active().includes('web_search'));
  await f.web('on');
  f.hooks.get('session_start')({}, f.ctx);
  assert.ok(!f.active().includes('web_search'));
});

test('failed analysis submission releases its web lock without enabling web', async () => {
  const f = fixture();
  f.bus.get('pi-response:case-analysis')();
  f.bus.get('pi-response:case-analysis-end')();
  assert.ok(!f.active().includes('web_search'));
  await f.web('on');
  assert.ok(f.active().includes('web_search'));
});

test('stale disclosure acceptance cannot enable web across an IR operation', async () => {
  const f = fixture();
  f.ctx.ui.confirm = async () => { f.bus.get('pi-response:collection-start')(); f.bus.get('pi-response:collection-end')(); return true; };
  await assert.rejects(f.web('on'), /changed/);
  assert.ok(!f.active().includes('web_search'));
});

test('explicit tool restrictions cannot be bypassed by /web on', async () => {
  const f = fixture();
  const apply = f.pi.setActiveTools;
  f.pi.setActiveTools = names => apply(names.filter(name => !['web_search', 'url_context'].includes(name)));
  await assert.rejects(f.web('on'), /excluded by your tool selection/);
  const result = await f.tools.get('web_search').execute('1', { query: 'public advisory' }, undefined, undefined, f.ctx);
  assert.equal(result.isError, true);
  assert.equal(f.calls.length, 0);
});

test('turning web off aborts in-flight provider work and blocks later calls', async () => {
  const f = fixture(async (_id, _params, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ isError: true }), { once: true })));
  await f.web('on');
  const running = f.tools.get('web_search').execute('1', { query: 'public advisory' }, undefined, undefined, f.ctx);
  const signal = f.calls[0][2];
  await f.web('off');
  assert.equal(signal.aborted, true);
  assert.equal((await running).isError, true);
  assert.equal((await f.tools.get('web_search').execute('2', { query: 'public advisory' }, undefined, undefined, f.ctx)).isError, true);
  assert.equal(f.calls.length, 1);
});

test('invalid URLs, embedded credentials, oversized queries and nondialog opt-in are rejected', async () => {
  const f = fixture();
  f.ctx.hasUI = false;
  await assert.rejects(f.web('on'), /disclosure/);
  f.ctx.hasUI = true;
  await f.web('on');
  for (const params of [{ query: '' }, { query: 'a'.repeat(4001) }, { query: 'x', urls: ['file:///etc/passwd'] }, { query: 'x', urls: ['https://user:password@example.com'] }]) {
    assert.equal((await f.tools.get('web_search').execute('1', params, undefined, undefined, f.ctx)).isError, true);
  }
  assert.equal(f.calls.length, 0);
});

test('vendored source bytes match the pinned npm package file manifest', () => {
  const root = resolve(import.meta.dirname, '..');
  const pin = JSON.parse(readFileSync(resolve(root, 'web-search-release.json')));
  assert.equal(pin.version, '1.7.0');
  for (const [name, expected] of Object.entries(pin.files)) assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'vendor/pi-web-search', name))).digest('hex'), expected, name);
});
