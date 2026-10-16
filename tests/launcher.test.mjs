import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const setup = spawnSync('pwsh.exe', ['-NoProfile', '-File', join(root, 'tests/prepare-fixture.ps1')], { encoding: 'utf8' });
assert.equal(setup.status, 0, setup.stdout + setup.stderr);
const launcher = join(root, '.build/fixture-launcher.exe');
const scratch = mkdtempSync(join(root, '.build/launcher tests '));
const decode = (s) => Buffer.from(s, 'base64').toString('utf8');
function run(args = [], options = {}) {
  const home = options.home ?? join(scratch, 'portable home');
  const child = spawnSync(options.launcher ?? launcher, args, {
    cwd: scratch, env: { ...process.env, OLLAMA_API_KEY: '', ...options.env, PI_PORTABLE_HOME: home, PI_CODING_AGENT_DIR: 'ignored-host-config' },
    encoding: 'utf8', input: options.input, timeout: 30000,
  });
  const lines = (child.stdout ?? '').trim().split(/\r?\n/);
  const actualArgs = lines.filter(x => x.startsWith('A:')).map(x => decode(x.slice(2)));
  const env = Object.fromEntries(lines.filter(x => x.startsWith('E:')).map(x => {
    const index = x.indexOf(':', 2); return [x.slice(2, index), decode(x.slice(index + 1))];
  }));
  return { ...child, actualArgs, env, home, lines };
}

test('forwards Windows arguments, current directory, stdin and exit code', () => {
  const args = ['--fixture-fail', '--fixture-stdin', '', 'space in value', 'quote"inside', 'C:\\trailing path\\', 'back\\\"quote', 'Unicode \u03c0 \u65e5\u672c', '--', '--portable-info'];
  const result = run(args, { input: 'piped input\n' });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(result.actualArgs.slice(-args.length), args);
  assert.equal(decode(result.lines.find(x => x.startsWith('C:')).slice(2)), scratch);
  assert.equal(decode(result.lines.find(x => x.startsWith('I:')).slice(2)), 'piped input\n');
  assert.equal(result.env.PI_CODING_AGENT_DIR, join(result.home, 'agent'));
  assert.equal(result.env.PI_CODING_AGENT_SESSION_DIR, join(result.home, 'sessions'));
  assert.equal(result.env.TEMP, join(result.home, 'tmp'));
  assert.equal(result.env.PI_OFFLINE, '1');
  assert.equal(result.env.PI_TELEMETRY, '0');
  assert.ok(result.actualArgs.includes('--no-context-files'));
  assert.ok(result.actualArgs.includes('--extension'));
  assert.equal(result.env.PI_PORTABLE_VERSION, JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).version);
  assert.ok(result.actualArgs.includes('read,powershell,grep,find,ls'));
});

test('saved Ollama key is reused without prompting and environment can override it', () => {
  const home = join(scratch, 'saved key');
  const agent = join(home, 'agent'); mkdirSync(agent, { recursive: true });
  const keyPath = join(agent, 'ollama-cloud.key'); writeFileSync(keyPath, 'synthetic-saved-key');
  const saved = run([], { home });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.env.OLLAMA_API_KEY, 'synthetic-saved-key');
  assert.ok(!saved.stderr.includes('synthetic-saved-key'));
  const override = run([], { home, env: { OLLAMA_API_KEY: 'synthetic-override' } });
  assert.equal(override.env.OLLAMA_API_KEY, 'synthetic-override');
  assert.equal(readFileSync(keyPath, 'utf8'), 'synthetic-saved-key');
});

test('explicit setup refuses redirected input without consuming a prompt or saving a key', () => {
  const home = join(scratch, 'noninteractive setup');
  const result = run(['--portable-setup'], { home, input: 'do-not-save-piped-input' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires an interactive console/);
  assert.ok(!existsSync(join(home, 'agent/ollama-cloud.key')));
  assert.ok(!result.stderr.includes('do-not-save-piped-input'));
});

test('hidden secret input supports editing and cancellation without echoing characters', () => {
  const result = spawnSync(join(root, '.build/secret-input-test.exe'), [launcher], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no echo passed/);
});

test('explicit tools replace defaults, and subcommands keep first position', () => {
  const custom = run(['--tools', 'read,write']);
  assert.equal(custom.status, 0, custom.stderr);
  assert.ok(!custom.actualArgs.includes('read,powershell,grep,find,ls'));
  assert.deepEqual(run(['auth', '--help']).actualArgs, ['auth', '--help']);
  assert.ok(!run(['--no-tools']).actualArgs.includes('--tools'));
});

test('info and notices require no extraction', () => {
  const home = join(scratch, 'info only');
  const info = run(['--portable-info'], { home });
  assert.equal(info.status, 0);
  const version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).version;
  assert.ok(info.stdout.includes(`Pi Portable ${version} / Windows x64`));
  assert.equal(run(['--portable-notices'], { home }).status, 0);
  assert.ok(!existsSync(home));
});

test('modified cached runtime is rejected before execution', () => {
  const home = join(scratch, 'tamper');
  assert.equal(run([], { home }).status, 0);
  const runtime = join(home, 'runtime', readdirSync(join(home, 'runtime'))[0], 'pi.exe');
  const bytes = readFileSync(runtime); bytes[bytes.length - 1] ^= 1; writeFileSync(runtime, bytes);
  const result = run([], { home });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /modified/);
});

test('archive traversal is rejected without writing outside runtime', () => {
  const home = join(scratch, 'traversal');
  const result = run([], { home, launcher: join(root, '.build/unsafe-launcher.exe') });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsafe archive path/);
  assert.ok(!existsSync(join(home, 'runtime', 'escaped.txt')));
});

test('copying only the EXE creates state beside its new location', () => {
  const folder = join(scratch, 'USB drive'); mkdirSync(folder);
  const copied = join(folder, 'pi-portable.exe'); copyFileSync(launcher, copied);
  const env = { ...process.env, OLLAMA_API_KEY: '' }; delete env.PI_PORTABLE_HOME;
  const child = spawnSync(copied, [], { cwd: scratch, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(existsSync(join(folder, 'pi-portable-data/agent')));
});

test('concurrent first launches share a complete runtime', async () => {
  const home = join(scratch, 'concurrent');
  const start = () => new Promise((resolveExit, reject) => {
    const child = spawn(launcher, [], { env: { ...process.env, OLLAMA_API_KEY: '', PI_PORTABLE_HOME: home }, stdio: 'ignore' });
    child.once('error', reject); child.once('exit', resolveExit);
  });
  assert.deepEqual(await Promise.all([start(), start()]), [0, 0]);
  assert.equal(readdirSync(join(home, 'runtime')).length, 1);
});

test('junctions in portable paths are rejected', () => {
  const target = join(scratch, 'junction target'); mkdirSync(target);
  const home = join(scratch, 'junction home'); symlinkSync(target, home, 'junction');
  const result = run([], { home });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /junction/);
  assert.equal(readdirSync(target).length, 0);
});

test('seeds the Ollama Cloud preset without credentials and preserves existing config', () => {
  const home = join(scratch, 'cloud preset');
  assert.equal(run([], { home }).status, 0);
  const modelsPath = join(home, 'agent/models.json');
  const settingsPath = join(home, 'agent/settings.json');
  const models = JSON.parse(readFileSync(modelsPath, 'utf8'));
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.defaultProvider, 'ollama-cloud');
  assert.equal(settings.defaultModel, 'deepseek-v4.1-flash');
  assert.equal(models.providers['ollama-cloud'].baseUrl, 'https://ollama.com/v1');
  assert.equal(models.providers['ollama-cloud'].apiKey, '${OLLAMA_API_KEY}');
  const customModels = '{"providers":{}}\n';
  const customSettings = '{"defaultProvider":"custom"}\n';
  writeFileSync(modelsPath, customModels); writeFileSync(settingsPath, customSettings);
  assert.equal(run([], { home }).status, 0);
  assert.equal(readFileSync(modelsPath, 'utf8'), customModels);
  assert.equal(readFileSync(settingsPath, 'utf8'), customSettings);
});
