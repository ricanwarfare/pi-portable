import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(root, '.build/signing-tests-'));
const binary = join(scratch, 'pi-response.exe');
for (const suffix of ['', '.sha256', '.build.json']) copyFileSync(join(root, `dist/pi-response.exe${suffix}`), `${binary}${suffix}`);
const run = (...args) => spawnSync('pwsh.exe', ['-NoProfile', '-File', join(root, 'scripts/finalize-windows-release.ps1'), '-Path', binary, ...args], { encoding: 'utf8' });

test('unsigned metadata is accurate; missing credentials, unsigned signatures and changed bytes cannot pass signed release checks', () => {
  let result = run('-Mode', 'Unsigned');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = readFileSync(`${binary}.build.json`, 'utf8');
  assert.equal(JSON.parse(manifest).signature.status, 'unsigned');
  assert.notEqual(run('-Mode', 'Signed').status, 0);
  assert.notEqual(run('-Mode', 'Signed', '-ExpectedSubject', 'CN=Unconfigured Publisher').status, 0);
  assert.notEqual(run('-Mode', 'Unsigned', '-ExpectedCommit', 'wrong-commit').status, 0);
  assert.equal(readFileSync(`${binary}.build.json`, 'utf8'), manifest);
  for (const value of [true, null, 0, 'false', [], undefined]) {
    const dirty = JSON.parse(manifest); dirty.sourceDirty = value; dirty.sourceCommit = 'synthetic-test-commit';
    writeFileSync(`${binary}.build.json`, JSON.stringify(dirty));
    assert.notEqual(run('-Mode', 'Unsigned', '-ExpectedCommit', dirty.sourceCommit).status, 0);
    assert.equal(readFileSync(`${binary}.build.json`, 'utf8'), JSON.stringify(dirty));
  }
  const clean = JSON.parse(manifest); clean.sourceDirty = false; clean.sourceCommit = 'synthetic-test-commit';
  writeFileSync(`${binary}.build.json`, JSON.stringify(clean));
  const verified = run('-Mode', 'Unsigned', '-ExpectedCommit', clean.sourceCommit);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  writeFileSync(`${binary}.build.json`, manifest);
  const bytes = readFileSync(binary); bytes[bytes.length - 1] ^= 1; writeFileSync(binary, bytes);
  assert.notEqual(run('-Mode', 'Unsigned').status, 0);
  assert.equal(readFileSync(`${binary}.build.json`, 'utf8'), manifest);
});
