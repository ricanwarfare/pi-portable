import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const setup = spawnSync('pwsh.exe', ['-NoProfile', '-File', join(root, 'tests/prepare-fixture.ps1')], { encoding: 'utf8' });
assert.equal(setup.status, 0, setup.stdout + setup.stderr);
const launcher = join(root, '.build/fixture-launcher.exe');
const scratch = mkdtempSync(join(root, '.build/launcher '));
const decode = text => Buffer.from(text, 'base64').toString('utf8');
const baseConfig = { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-coder', auth: 'none' };
function run(args = [], options = {}) {
  const home = options.home ?? join(scratch, 'home');
  mkdirSync(home, { recursive: true });
  if (!existsSync(join(home, 'portable.json'))) writeFileSync(join(home, 'portable.json'), JSON.stringify(options.config ?? baseConfig));
  const child = spawnSync(options.launcher ?? launcher, args, {
    cwd: options.cwd ?? scratch, env: { ...process.env, PI_PORTABLE_HOME: home, PI_PORTABLE_API_KEY: '', ...options.env },
    encoding: 'utf8', input: options.input, timeout: 30000,
  });
  const lines = (child.stdout ?? '').trim().split(/\r?\n/);
  const actualArgs = lines.filter(x => x.startsWith('A:')).map(x => decode(x.slice(2)));
  const env = Object.fromEntries(lines.filter(x => x.startsWith('E:')).map(x => { const index = x.indexOf(':', 2); return [x.slice(2, index), decode(x.slice(index + 1))]; }));
  return { ...child, home, actualArgs, env, lines };
}

test('forwards literal Windows arguments, Unicode, stdin and exit code', () => {
  const args = ['--', '--fixture-fail', '--fixture-stdin', '', 'space in value', 'quote"inside', 'C:\\trailing path\\', 'back\\\"quote', 'Unicode π 日本', '--portable-info'];
  const result = run(args, { input: 'piped input\n' });
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(result.actualArgs.slice(-args.length), args);
  assert.equal(decode(result.lines.find(x => x.startsWith('I:')).slice(2)), 'piped input\n');
  assert.equal(result.env.PI_OFFLINE, '1'); assert.equal(result.env.PI_TELEMETRY, '0');
  assert.ok(result.actualArgs.includes('--no-context-files'));
  assert.ok(result.actualArgs.includes('read,grep,find,ls'));
  assert.ok(result.env.PI_CODING_AGENT_DIR.startsWith(join(result.home, 'runs')));
});

test('profiles apply again on resumed sessions and cannot be overridden with upstream flags', () => {
  assert.ok(run(['--profile', 'edit', '--continue']).actualArgs.includes('read,grep,find,ls,write,edit'));
  assert.ok(run(['--profile', 'full', '--resume']).actualArgs.includes('read,grep,find,ls,write,edit,powershell'));
  for (const args of [['--tools', 'powershell'], ['--provider', 'openai'], ['--extension', 'hostile.mjs'], ['--api-key', 'secret'], ['install', 'npm:hostile'], ['--profile', 'invalid'], ['--project-id', '../outside']])
    assert.equal(run(args).status, 1, args.join(' '));
});

test('project roots and stable explicit ids partition sessions', () => {
  const project = join(scratch, 'project'); mkdirSync(join(project, '.git'), { recursive: true }); mkdirSync(join(project, 'child'));
  const first = run(['--project', join(project, 'child'), '--project-id', 'portable-project']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(decode(first.lines.find(x => x.startsWith('C:')).slice(2)), project);
  assert.equal(first.env.PI_CODING_AGENT_SESSION_DIR, join(first.home, 'sessions/portable-project'));
  assert.notEqual(first.env.PI_CODING_AGENT_SESSION_DIR, run(['--project', scratch]).env.PI_CODING_AGENT_SESSION_DIR);
});

test('session-only keys are not written; redirected setup fails without consuming input', () => {
  const home = join(scratch, 'credentials');
  const config = { ...baseConfig, auth: 'bearer' };
  const result = run([], { home, config, env: { PI_PORTABLE_API_KEY: 'synthetic-session' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.env.PI_PORTABLE_RUNTIME_KEY, 'synthetic-session');
  for (const dir of readdirSync(join(home, 'runs'))) {
    assert.ok(!existsSync(join(home, 'runs', dir, 'agent/auth.json')));
    assert.ok(!existsSync(join(home, 'runs', dir, 'agent/models.json')));
  }
  const failed = run(['--session-key'], { home, input: 'do-not-consume' });
  assert.equal(failed.status, 1); assert.match(failed.stderr, /requires a terminal/);
  assert.ok(!failed.stderr.includes('do-not-consume'));
  const hidden = spawnSync(join(root, '.build/secret-input-test.exe'), [launcher], { encoding: 'utf8' });
  assert.equal(hidden.status, 0, hidden.stdout + hidden.stderr);
});

test('info, configure and notices work without extraction or credentials', () => {
  const home = join(scratch, 'local-only');
  const info = spawnSync(launcher, ['--portable-info'], { env: { ...process.env, PI_PORTABLE_HOME: home }, encoding: 'utf8' });
  assert.equal(info.status, 0, info.stderr); assert.ok(!existsSync(home));
  const config = spawnSync(launcher, ['--configure'], { env: { ...process.env, PI_PORTABLE_HOME: home }, encoding: 'utf8' });
  assert.equal(config.status, 0, config.stderr); assert.ok(!existsSync(join(home, 'runtime')));
  assert.equal(run(['--portable-notices']).status, 0);
});

test('malformed config, missing values and misspelled fields fail closed', () => {
  for (const config of [{ ...baseConfig, secret: 'bad' }, { ...baseConfig, baseUrl: 'https://user:secret@internal/v1' }, { ...baseConfig, kind: 'unknown' }, { ...baseConfig, keyEnv: '!command' }]) {
    const home = mkdtempSync(join(scratch, 'invalid-'));
    assert.equal(run([], { home, config }).status, 1);
  }
  assert.equal(run(['--project']).status, 1);
});

test('runtime corruption, extra files, archive traversal and junctions are rejected', () => {
  const home = join(scratch, 'tamper'); assert.equal(run([], { home }).status, 0);
  const runtime = join(home, 'runtime', readdirSync(join(home, 'runtime'))[0]);
  const bytes = readFileSync(join(runtime, 'pi.exe')); bytes[bytes.length - 1] ^= 1; writeFileSync(join(runtime, 'pi.exe'), bytes);
  assert.match(run([], { home }).stderr, /modified/);
  const extraHome = join(scratch, 'extra'); assert.equal(run([], { home: extraHome }).status, 0);
  const extraRuntime = join(extraHome, 'runtime', readdirSync(join(extraHome, 'runtime'))[0]);
  writeFileSync(join(extraRuntime, 'extra.dll'), 'bad'); assert.match(run([], { home: extraHome }).stderr, /Unexpected runtime/);
  assert.match(run([], { launcher: join(root, '.build/unsafe-launcher.exe') }).stderr, /Unsafe archive path/);
  const target = join(scratch, 'target'); mkdirSync(target);
  const link = join(scratch, 'junction'); symlinkSync(target, link, 'junction');
  assert.match(run([], { home: link }).stderr, /junction/);
});

test('only the EXE is needed after relocation; user-profile storage is selectable', () => {
  const folder = join(scratch, 'USB folder'); mkdirSync(folder);
  const copied = join(folder, 'pi-portable.exe'); copyFileSync(launcher, copied);
  const env = { ...process.env }; delete env.PI_PORTABLE_HOME; delete env.PI_PORTABLE_STORAGE;
  const configured = spawnSync(copied, ['--configure'], { env, encoding: 'utf8' }); assert.equal(configured.status, 0, configured.stderr);
  const configPath = join(folder, 'pi-portable-data/portable.json'); writeFileSync(configPath, JSON.stringify(baseConfig));
  const result = spawnSync(copied, [], { cwd: scratch, env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(folder, 'pi-portable-data/runtime')));
  const user = spawnSync(copied, ['--portable-storage', 'user', '--portable-info'], { env, encoding: 'utf8' });
  assert.equal(user.status, 0); assert.ok(user.stdout.includes(join(process.env.LOCALAPPDATA, 'PiPortable')));
});

test('concurrent launches share a verified runtime with separate launch state', async () => {
  const home = join(scratch, 'concurrent'); run([], { home });
  const launch = () => new Promise((resolveExit, reject) => {
    const child = spawn(launcher, ['--', '--fixture-quiet'], { env: { ...process.env, PI_PORTABLE_HOME: home }, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', resolveExit);
  });
  assert.deepEqual(await Promise.all([launch(), launch()]), [0, 0]);
  assert.equal(readdirSync(join(home, 'runtime')).length, 1);
});
