import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import settings from '../src/settings.ts';

test('settings commands are user-only, preserve cancellation and request restart only after Save', async () => {
  const commands = new Map(); const events = new Map(); let launches = 0, writes = 0, shutdowns = 0, idle = 0, status = 2;
  settings({ registerCommand: (name, value) => commands.set(name, value), on: (name, callback) => events.set(name, callback) }, {
    launch: (_file, args, options) => { launches++; assert.ok(args.includes('--settings')); assert.equal(options.stdio, 'inherit'); const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', status)); return child; },
    write: (_path, marker, options) => { writes++; assert.equal(marker, 'settings-saved'); assert.equal(options.flag, 'wx'); },
  });
  assert.deepEqual([...commands.keys()].sort(), ['delegation', 'portable', 'web']);
  const ctx = { mode: 'rpc', cwd: 'C:\\Project with spaces', ui: { notify() {} }, waitForIdle: async () => { idle++; }, shutdown: () => { shutdowns++; } };
  await commands.get('portable').handler('', ctx); assert.equal(launches, 0);
  ctx.mode = 'tui';
  await commands.get('web').handler('', ctx); assert.equal(writes, 0); assert.equal(shutdowns, 0);
  status = 1; await commands.get('portable').handler('', ctx); assert.equal(writes, 0);
  status = 0; await commands.get('delegation').handler('', ctx); assert.equal(writes, 1); assert.equal(shutdowns, 1); assert.equal(idle, 3);
});

test('actual packaged runtime exposes portable settings commands without a model or public network request', async () => {
  const root = resolve(import.meta.dirname, '..'); const home = mkdtempSync(join(root, '.build/settings-runtime '));
  writeFileSync(join(home, 'portable.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:1/v1', model: 'saved-model', auth: 'none', proxy: 'direct' }));
  const result = await new Promise((done, reject) => {
    const child = spawn(join(root, 'dist/pi-portable.exe'), ['--portable-home', home, '--mode', 'rpc'], { env: { ...process.env, PI_PORTABLE_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '', matched = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Settings RPC timed out: ${output}\n${error}`)); }, 45000);
    child.stdout.on('data', data => {
      output += data;
      for (const line of output.split(/\r?\n/)) {
        try {
          const value = JSON.parse(line);
          if (value.id === 'portable-settings-test' && value.type === 'response') {
            assert.equal(value.success, true); const names = value.data.commands.map(command => command.name);
            for (const name of ['portable', 'web', 'delegation']) assert.ok(names.includes(name), JSON.stringify(names));
            matched = true; child.stdin.end();
          }
        } catch (problem) { if (problem instanceof assert.AssertionError) { child.kill(); reject(problem); } }
      }
    });
    child.stderr.on('data', data => { error += data; }); child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); done({ code, output, error, matched }); });
    child.stdin.write(JSON.stringify({ id: 'portable-settings-test', type: 'get_commands' }) + '\n');
  });
  assert.equal(result.code, 0, result.output + result.error); assert.equal(result.matched, true);
});
