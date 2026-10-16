import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';

// A local fake model requests actual tools; no provider account, key, or paid tokens.
const root = resolve(import.meta.dirname, '..');
const linux = process.platform === 'linux';
const scratch = await mkdtemp(join(root, '.build/runtime smoke '));
const home = join(scratch, 'portable home');
await mkdir(join(home, 'agent'), { recursive: true });
await writeFile(join(scratch, 'evidence.txt'), 'PORTABLE_EVIDENCE_MARKER\n');
// Discovery of instructions and extensions in the working directory must stay disabled.
await writeFile(join(scratch, 'AGENTS.md'), 'UNTRUSTED_WORKSPACE_INSTRUCTION_MARKER');
await mkdir(join(scratch, '.pi/extensions'), { recursive: true });
await writeFile(join(scratch, '.pi/extensions/hostile.ts'), 'throw new Error("UNTRUSTED_EXTENSION_LOADED");');
const calls = [
  linux ? ['bash', { command: "printf 'PORTABLE_BASH_OK\\n'" }, 'PORTABLE_BASH_OK'] : ['powershell', { command: "[Console]::WriteLine('PORTABLE_POWERSHELL_OK')" }, 'PORTABLE_POWERSHELL_OK'],
  ['read', { path: 'evidence.txt' }, 'PORTABLE_EVIDENCE_MARKER'],
  ['grep', { pattern: 'PORTABLE_EVIDENCE_MARKER', path: 'evidence.txt' }, 'PORTABLE_EVIDENCE_MARKER'],
  ['find', { pattern: '*.txt', path: '.' }, 'evidence.txt'],
  ['ls', { path: '.' }, 'evidence.txt'],
];
let requests = 0;
let serverError;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST');
    assert.ok(req.url.endsWith('/chat/completions'));
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    assert.equal(req.headers.authorization, 'Bearer local-test');
    assert.equal(body.model, 'deepseek-v4.1-flash');
    assert.ok(!('store' in body));
    assert.ok(!('max_completion_tokens' in body));
    assert.ok(body.messages.every(message => message.role !== 'developer'));
    assert.ok(!text.includes('UNTRUSTED_WORKSPACE_INSTRUCTION_MARKER'));
    const tools = body.tools.map(tool => tool.function.name);
    assert.deepEqual(tools.sort(), calls.map(call => call[0]).sort());
    const previousResults = body.messages.filter(message => message.role === 'tool');
    for (let i = 0; i < previousResults.length; i++) {
      assert.ok(JSON.stringify(previousResults[i].content).includes(calls[i][2]), JSON.stringify(previousResults[i]));
    }
    const index = requests++;
    const delta = index < calls.length ? {
      role: 'assistant', tool_calls: [{ index: 0, id: `call_${index}`, type: 'function', function: {
        name: calls[index][0], arguments: JSON.stringify(calls[index][1]),
      } }],
    } : { role: 'assistant', content: 'PI_RESPONSE_SMOKE_OK' };
    const chunk = (value, finish_reason = null) => ({
      id: `chatcmpl-${index}`, object: 'chat.completion.chunk', created: 0, model: 'portable-smoke',
      choices: [{ index: 0, delta: value, finish_reason }], usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
    res.end(`data: ${JSON.stringify(chunk(delta))}\n\ndata: ${JSON.stringify(chunk({}, index < calls.length ? 'tool_calls' : 'stop'))}\n\ndata: [DONE]\n\n`);
  } catch (error) { serverError = error; res.writeHead(500).end(String(error)); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
try {
  // Use the shipped preset, changing only its URL to the fake local service.
  const preset = JSON.parse(await readFile(join(root, 'config/models.json'), 'utf8'));
  preset.providers['ollama-cloud'].baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(home, 'agent/models.json'), JSON.stringify(preset));
  await writeFile(join(home, 'agent/ollama-cloud.key'), 'local-test');
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  const child = spawn(join(root, linux ? 'dist/pi-response-linux-x64' : 'dist/pi-response.exe'), ['--print', 'Run the tool smoke test.'], {
    cwd: scratch,
    env: { ...process.env, OLLAMA_API_KEY: '', PI_RESPONSE_HOME: home, PATH: linux ? '/usr/bin:/bin' : [join(windows, 'System32'), windows, join(windows, 'System32/WindowsPowerShell/v1.0')].join(';') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Runtime smoke timed out')); }, 60000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', value => { clearTimeout(timer); resolveExit(value); });
  });
  if (serverError) throw serverError;
  assert.equal(code, 0, stdout + stderr);
  assert.ok(stdout.includes('PI_RESPONSE_SMOKE_OK'), stdout + stderr);
  assert.equal(requests, calls.length + 1);
  const sessionProjects = await readdir(join(home, 'sessions'));
  assert.ok(sessionProjects.length > 0, 'session must be saved under portable home');
  const savedModels = await readFile(join(home, 'agent/models.json'), 'utf8');
  assert.ok(!savedModels.includes('local-test'), 'key must not be saved to config');
  console.log(`PASS: Ollama Cloud preset, default DeepSeek 4.1 selection, saved-key Bearer authentication, ${linux ? 'Bash' : 'PowerShell'}, read, grep, find, ls; portable sessions; disabled workspace discovery; system-only PATH.`);
  console.log(`Test artifacts: ${scratch}`);
} finally { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
