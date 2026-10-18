import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(root, '.build/subagents-runtime ')); mkdirSync(join(scratch, '.git'));
const systemPath = [join(process.env.SystemRoot, 'System32'), process.env.SystemRoot, join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(';');
function sse(res, delta, finish = 'stop') {
  const chunk = (value, finish_reason = null) => ({ id: 'subagents-test', object: 'chat.completion.chunk', created: 0, model: 'local-coder', choices: [{ index: 0, delta: value, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
  res.end(`data: ${JSON.stringify(chunk(delta))}\n\ndata: ${JSON.stringify(chunk({}, finish))}\n\ndata: [DONE]\n\n`);
}
function tool(res, name, params, id = 'call') { sse(res, { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(params) } }] }, 'tool_calls'); }
function run(baseUrl, home, args = [], config = {}) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'portable.json'), JSON.stringify({ baseUrl, model: 'local-coder', auth: 'bearer', proxy: 'direct', ...config }));
  return new Promise((done, reject) => {
    const child = spawn(join(root, 'dist/pi-portable.exe'), ['--project', scratch, '--print', 'PARENT_PORTABLE_TEST', ...args], {
      cwd: scratch, env: { ...process.env, PATH: systemPath, PI_PORTABLE_HOME: home, PI_PORTABLE_API_KEY: 'synthetic-parent-secret', EXA_API_KEY: '', BRAVE_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out: ${stdout}\n${stderr}`)); }, 90000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => { clearTimeout(timer); done({ status, stdout, stderr }); });
  });
}
function files(dir) { return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; }); }

test('bundled subagents enforce profiles, isolate web credentials and execute foreground single/parallel/chain sessions', async () => {
  let mode = 'off', parentStep = 0, childCalls = 0, webCalls = 0, activeParallel = 0, peakParallel = 0, serverError;
  writeFileSync(join(scratch, 'child-input.txt'), 'CHILD_READ_MARKER');
  mkdirSync(join(scratch, '.pi/agents'), { recursive: true });
  writeFileSync(join(scratch, '.pi/agents/oracle.md'), '---\nname: oracle\ndescription: Untrusted override\ntools: write\n---\nAMBIENT_AGENT_OVERRIDE_MUST_NOT_LOAD');
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/mcp') {
        assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['api-key'], undefined); webCalls++;
        let text = ''; for await (const chunk of req) text += chunk;
        assert.equal(JSON.parse(text).params.name, 'web_search_exa');
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { content: [{ type: 'text', text: 'Title: Local source\nURL: https://example.invalid/source\nText: WEB_CHILD_MARKER' }] } })); return;
      }
      assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer synthetic-parent-secret');
      let text = ''; for await (const chunk of req) text += chunk;
      const payload = JSON.parse(text); assert.equal(payload.model, 'local-coder');
      assert.ok(!JSON.stringify(payload).includes('AMBIENT_AGENT_OVERRIDE_MUST_NOT_LOAD'));
      const names = payload.tools.map(tool => tool.function.name);
      if (mode === 'off') { assert.ok(!names.includes('subagent')); sse(res, { role: 'assistant', content: 'SUBAGENTS_OFF_OK' }); return; }
      if (mode === 'edit' || mode === 'full') {
        const results = payload.messages.filter(message => message.role === 'tool');
        if (names.includes('subagent')) {
          if (!results.length) tool(res, 'subagent', { agent: 'worker', task: 'Write child-output.txt with CHILD_WRITE_MARKER', async: false }, 'write-child');
          else { assert.ok(JSON.stringify(results).includes('CHILD_WRITE_OK'), JSON.stringify(results)); sse(res, { role: 'assistant', content: 'CHILD_EDIT_PROFILE_OK' }); }
        } else {
          assert.ok(names.includes('write')); assert.equal(names.includes('powershell'), mode === 'full'); assert.ok(!names.includes('bash'));
          if (!results.length && mode === 'full') tool(res, 'powershell', { command: "Set-Content -LiteralPath child-shell.txt -Value CHILD_SHELL_MARKER" }, 'child-shell');
          else if (!results.length) tool(res, 'write', { path: 'child-output.txt', content: 'CHILD_WRITE_MARKER' }, 'child-write');
          else sse(res, { role: 'assistant', content: 'CHILD_WRITE_OK' });
        }
        return;
      }
      if (names.includes('subagent')) {
        if (parentStep++ === 0) tool(res, 'subagent', { action: 'list' }, 'list');
        else if (parentStep === 2) {
          assert.ok(payload.messages.some(message => message.role === 'tool' && JSON.stringify(message).includes('reviewer')));
          tool(res, 'subagent', { agent: 'oracle', task: 'CHILD_PORTABLE_TEST: return CHILD_RESULT_OK', async: false }, 'delegate');
        } else if (parentStep === 3) {
          const results = payload.messages.filter(message => message.role === 'tool');
          assert.ok(JSON.stringify(results.at(-1)).includes('CHILD_RESULT_OK'), JSON.stringify(results.at(-1)));
          tool(res, 'subagent', { agent: 'oracle', task: 'Do not start this', async: true }, 'blocked-async');
        } else if (parentStep === 4) {
          assert.ok(JSON.stringify(payload.messages.at(-1)).includes('disabled'), JSON.stringify(payload.messages.at(-1)));
          tool(res, 'subagent', { agent: 'oracle', task: 'Do not start this', model: 'openai/public-model', async: false }, 'blocked-model');
        } else if (parentStep === 5) {
          assert.ok(JSON.stringify(payload.messages.at(-1)).includes('configured portable model'));
          tool(res, 'subagent', { tasks: [{ agent: 'oracle', task: 'CHILD_PARALLEL_A return CHILD_RESULT_OK' }, { agent: 'oracle', task: 'CHILD_PARALLEL_B return CHILD_RESULT_OK' }], async: false }, 'parallel');
        } else if (parentStep === 6) {
          assert.ok(JSON.stringify(payload.messages.at(-1)).includes('CHILD_RESULT_OK'), JSON.stringify(payload.messages.at(-1)));
          tool(res, 'subagent', { chain: [{ agent: 'oracle', task: 'CHILD_CHAIN_A return CHILD_RESULT_OK' }, { agent: 'reviewer', task: 'CHILD_CHAIN_B return CHILD_RESULT_OK' }], async: false }, 'chain');
        } else if (parentStep === 7) {
          assert.ok(JSON.stringify(payload.messages.at(-1)).includes('CHILD_RESULT_OK'), JSON.stringify(payload.messages.at(-1)));
          tool(res, 'subagent', { agent: 'researcher', task: 'CHILD_WEB_TEST use web_search then return CHILD_RESULT_OK', async: false }, 'web-child');
        } else {
          assert.ok(JSON.stringify(payload.messages.at(-1)).includes('CHILD_RESULT_OK'), JSON.stringify(payload.messages.at(-1)));
          sse(res, { role: 'assistant', content: 'SUBAGENT_RUNTIME_OK' });
        }
      } else {
        assert.ok(!names.includes('write')); assert.ok(!names.includes('edit')); assert.ok(!names.includes('bash')); assert.ok(!names.includes('powershell'));
        const results = payload.messages.filter(message => message.role === 'tool');
        const childText = JSON.stringify(payload.messages.filter(message => message.role === 'user'));
        if (!results.length) {
          childCalls++;
          if (childText.includes('CHILD_WEB_TEST')) { assert.ok(names.includes('web_search')); tool(res, 'web_search', { query: 'synthetic internal query' }, 'child-search'); return; }
          if (childText.includes('CHILD_PORTABLE_TEST')) { tool(res, 'read', { path: 'child-input.txt' }, 'child-read'); return; }
        } else {
          assert.ok(JSON.stringify(results).includes(childText.includes('CHILD_WEB_TEST') ? 'WEB_CHILD_MARKER' : 'CHILD_READ_MARKER'));
          if (childText.includes('CHILD_PORTABLE_TEST') && results.length === 1) { tool(res, 'write', { path: 'forbidden.txt', content: 'must not write' }, 'forbidden-write'); return; }
          if (childText.includes('CHILD_PORTABLE_TEST')) assert.match(JSON.stringify(results.at(-1)), /disabled|outside|not found|unknown|not available/i);
        }
        if (childText.includes('CHILD_PARALLEL')) {
          activeParallel++; peakParallel = Math.max(peakParallel, activeParallel);
          await new Promise(done => setTimeout(done, 200)); activeParallel--;
        }
        if (childText.includes('CHILD_CHAIN_B')) assert.ok(childText.includes('CHILD_RESULT_OK'), 'chain receives previous result');
        sse(res, { role: 'assistant', content: 'CHILD_RESULT_OK' });
      }
    } catch (error) { if (!serverError) console.error(error); serverError ??= error; res.writeHead(500).end('test assertion failed'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done)); const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const webServer = createServer(server.listeners('request')[0]);
  await new Promise(done => webServer.listen(0, '127.0.0.1', done));
  try {
    const disabled = await run(baseUrl, join(scratch, 'off')); if (serverError) throw serverError;
    assert.equal(disabled.status, 0, disabled.stdout + disabled.stderr); assert.match(disabled.stdout, /SUBAGENTS_OFF_OK/);
    const forcedOff = await run(baseUrl, join(scratch, 'off'), ['--no-subagents'], { subagents: { enabled: true } });
    assert.equal(forcedOff.status, 0, forcedOff.stdout + forcedOff.stderr); assert.match(forcedOff.stdout, /SUBAGENTS_OFF_OK/);
    mode = 'on';
    const origin = `http://127.0.0.1:${webServer.address().port}`;
    const enabled = await run(baseUrl, join(scratch, 'enabled'), ['--subagents', '--web'], { web: { allowedOrigins: [origin], endpoints: { exaMcp: `${origin}/mcp` } } }); if (serverError) throw serverError;
    assert.equal(enabled.status, 0, enabled.stdout + enabled.stderr); assert.match(enabled.stdout, /SUBAGENT_RUNTIME_OK/);
    assert.equal(childCalls, 6); assert.equal(webCalls, 1); assert.equal(peakParallel, 2);
    assert.ok(!existsSync(join(scratch, 'forbidden.txt')), 'review child cannot write');
    mode = 'edit';
    const editing = await run(baseUrl, join(scratch, 'enabled'), ['--profile', 'edit'], { subagents: { enabled: true } }); if (serverError) throw serverError;
    assert.equal(editing.status, 0, editing.stdout + editing.stderr); assert.match(editing.stdout, /CHILD_EDIT_PROFILE_OK/);
    assert.equal(readFileSync(join(scratch, 'child-output.txt'), 'utf8'), 'CHILD_WRITE_MARKER');
    mode = 'full';
    const full = await run(baseUrl, join(scratch, 'enabled'), ['--profile', 'full', '--subagents']); if (serverError) throw serverError;
    assert.equal(full.status, 0, full.stdout + full.stderr); assert.match(full.stdout, /CHILD_EDIT_PROFILE_OK/);
    assert.equal(readFileSync(join(scratch, 'child-shell.txt'), 'utf8').trim(), 'CHILD_SHELL_MARKER');
    assert.ok(!existsSync(join(scratch, '.pi/subagents')), 'artifacts must stay in portable state');
    const home = join(scratch, 'enabled');
    for (const path of files(home).filter(path => !path.includes(`${join(home, 'runtime')}\\`)))
      assert.ok(!readFileSync(path).includes(Buffer.from('synthetic-parent-secret')), `Credential persisted in ${path}`);
  } finally { server.closeAllConnections(); webServer.closeAllConnections(); await Promise.all([new Promise(done => server.close(done)), new Promise(done => webServer.close(done))]); }
});
