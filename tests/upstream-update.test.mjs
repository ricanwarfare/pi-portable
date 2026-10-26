import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRelease, prepareUpdate, runUpdate, verifyAsset, compareVersions } from '../scripts/update-upstream.mjs';
import { publish, releaseTag } from '../scripts/publish-release.mjs';
import { openUpdate } from '../scripts/open-upstream-pr.mjs';

const bytes = Buffer.from('synthetic Windows release ZIP, never executed');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const release = () => ({ id: 42, tag_name: 'v1.4.0', draft: false, prerelease: false,
  html_url: 'https://github.com/earendil-works/pi/releases/tag/v1.4.0', published_at: '2026-10-20T12:00:00Z',
  assets: [{ name: 'pi-windows-x64.zip', state: 'uploaded', size: bytes.length, digest: `sha256:${sha256}`,
    browser_download_url: 'https://github.com/earendil-works/pi/releases/download/v1.4.0/pi-windows-x64.zip' }] });
const files = () => ({
  'upstream-release.json': JSON.stringify({ version: '1.3.0', url: 'old', sha256: 'old', tools: [{ name: 'rg', sha256: 'unchanged' }] }),
  'version.json': '{"version":"1.3.0"}',
  'README.md': 'Release **1.3.0** bundles the official **Pi 1.3.0** executable.\nSettings remain intact.\n',
  'CHANGELOG.md': '# Changelog\r\n\r\n## 1.3.0\r\n\r\n- Previous release.\r\n',
  'THIRD_PARTY_NOTICES.md': '# Third-party software\n\n| Software | Pinned version/source | License |\n| --- | --- | --- |\n| Pi coding agent | 1.3.0, [earendil-works/pi](https://github.com/earendil-works/pi) | MIT |\n| ripgrep | 15.2.0, [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | MIT or Unlicense |\n',
});

test('stable release selection rejects prereleases, malformed versions, missing/wrong assets and digest spoofing', () => {
  assert.equal(selectRelease(release()).version, '1.4.0');
  const mutations = [
    r => r.draft = true, r => r.prerelease = true, r => r.tag_name = 'v1.4.0-rc.1',
    r => r.tag_name = 'v01.4.0', r => r.tag_name = 'v65535.4.0', r => r.tag_name = 'v1.4.0\nunsafe',
    r => r.html_url = 'https://example.invalid/release', r => r.id = -1, r => r.published_at = 'invalid',
    r => r.assets = [], r => r.assets.push({ ...r.assets[0] }), r => r.assets[0].digest = null,
    r => r.assets[0].digest = 'md5:' + sha256, r => r.assets[0].size = 0, r => r.assets[0].size = 2 ** 30,
    r => r.assets[0].state = 'new', r => r.assets[0].browser_download_url += '?token=secret',
    r => r.assets[0].browser_download_url = 'https://example.invalid/pi-windows-x64.zip',
  ];
  for (const mutate of mutations) { const r = release(); mutate(r); assert.throws(() => selectRelease(r)); }
});

test('versions compare numerically; upgrades align pins, docs and changelog while preserving tool pins', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.throws(() => compareVersions('1.4.0\n', '1.3.0'), /stable/);
  const before = files();
  const changes = prepareUpdate(before, selectRelease(release()));
  const pin = JSON.parse(changes['upstream-release.json']);
  assert.deepEqual(pin.tools, JSON.parse(before['upstream-release.json']).tools);
  assert.equal(pin.sha256, sha256);
  assert.equal(pin.release.id, 42);
  assert.equal(JSON.parse(changes['version.json']).version, '1.4.0');
  assert.match(changes['README.md'], /Release \*\*1\.4\.0\*\* bundles the official \*\*Pi 1\.4\.0\*\*/);
  assert.match(changes['README.md'], /Settings remain intact/);
  assert.match(changes['THIRD_PARTY_NOTICES.md'], /\| Pi coding agent \| 1\.4\.0, /);
  assert.match(changes['THIRD_PARTY_NOTICES.md'], /\| ripgrep \| 15\.2\.0, /);
  assert.match(changes['CHANGELOG.md'], /^# Changelog\n\n## 1\.4\.0\n/);
  assert.ok(changes['CHANGELOG.md'].includes('## 1.3.0\r\n\r\n- Previous release.'));
  assert.match(changes['CHANGELOG.md'], /https:\/\/github.com\/earendil-works\/pi\/releases\/tag\/v1.4.0/);
});

test('no-op is idempotent and retagged releases, downgrades and documentation drift require manual review', () => {
  const candidate = selectRelease(release());
  const updated = prepareUpdate(files(), candidate);
  assert.equal(prepareUpdate(updated, candidate), null);
  assert.throws(() => prepareUpdate(updated, { ...candidate, sha256: 'changed' }), /already pinned/);
  assert.throws(() => prepareUpdate(updated, { ...candidate, version: '1.3.9' }), /downgrade/);
  const drift = files(); drift['README.md'] = 'No marker';
  assert.throws(() => prepareUpdate(drift, candidate), /marker/);
  const noticesDrift = files(); noticesDrift['THIRD_PARTY_NOTICES.md'] = '# Third-party software\n\n| Software | Pinned version/source | License |\n| --- | --- | --- |\n';
  assert.throws(() => prepareUpdate(noticesDrift, candidate), /marker/);
  const ahead = files(); ahead['version.json'] = '{"version":"1.5.0"}';
  assert.throws(() => prepareUpdate(ahead, candidate), /exceed/);
  const duplicate = files(); duplicate['CHANGELOG.md'] += '\n## 1.4.0\n';
  assert.throws(() => prepareUpdate(duplicate, candidate), /already exists/);
});

test('download verifies actual bytes and size, rejects HTTP/hash/truncation errors and sends no auth header', async () => {
  const candidate = selectRelease(release());
  await verifyAsset(candidate, async (url, options) => {
    assert.equal(url, candidate.url);
    assert.equal(options.headers, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(bytes);
  });
  await assert.rejects(verifyAsset(candidate, async () => new Response('no', { status: 404 })), /download failed/);
  await assert.rejects(verifyAsset(candidate, async () => new Response(bytes.subarray(1))), /mismatch/);
  await assert.rejects(verifyAsset(candidate, async () => new Response(Buffer.alloc(bytes.length))), /mismatch/);
  await assert.rejects(verifyAsset(candidate, async () => new Response(Buffer.alloc(bytes.length + 1))), /exceeds/);
});

test('failed download and check-only mode leave tracked files intact; successful update becomes a zero-download no-op', async () => {
  const base = fileURLToPath(new URL('../.build/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'upstream-update-test-'));
  const before = files();
  const read = () => Object.fromEntries(Object.keys(before).map(name => [name, readFileSync(join(root, name), 'utf8')]));
  try {
    for (const [name, content] of Object.entries(before)) writeFileSync(join(root, name), content);
    await assert.rejects(runUpdate(root, release(), { fetcher: async () => new Response('corrupt') }));
    assert.deepEqual(read(), before);
    assert.equal((await runUpdate(root, release(), { check: true, fetcher: async () => new Response(bytes) })).changed, true);
    assert.deepEqual(read(), before);
    const result = await runUpdate(root, release(), { fetcher: async () => new Response(bytes) });
    assert.equal(result.branch, 'automation/pi-v1.4.0');
    assert.equal(JSON.parse(read()['version.json']).version, '1.4.0');
    const second = await runUpdate(root, release(), { fetcher: () => { throw new Error('No network expected'); } });
    assert.equal(second.changed, false);
  } finally {
    if (!resolve(root).startsWith(resolve(base) + sep)) throw new Error('Test cleanup escaped its workspace');
    rmSync(root, { recursive: true, force: true });
  }
});

const commit = 'a'.repeat(40);
test('bot PR policy rejection preserves review permissions and provides a manual PR link with an explicit test dispatch', () => {
  const calls = [];
  const summary = openUpdate({ version: '1.4.0', branch: 'automation/pi-v1.4.0', repository: 'ricanwarfare/pi-portable', server: 'https://github.com',
    git: args => { calls.push(['git', ...args]); return ''; },
    gh: args => {
      calls.push(['gh', ...args]);
      if (args[0] === 'pr' && args[1] === 'list') return '[]';
      if (args[0] === 'pr') throw Object.assign(new Error('policy'), { stderr: 'GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)' });
      return '';
    } });
  assert.match(summary, /compare\/main\.\.\.automation\/pi-v1\.4\.0\?expand=1/);
  assert.ok(calls.some(args => args[0] === 'git' && args[1] === 'push'));
  assert.deepEqual(calls.at(-1), ['gh', 'workflow', 'run', 'windows.yml', '--ref', 'automation/pi-v1.4.0']);
  assert.equal(calls.some(args => args.includes('api')), false);
});
test('existing update branch/PR are reused without overwriting commits; new PRs are created when allowed', () => {
  for (const hasPr of [true, false]) {
    const calls = [];
    const url = 'https://github.com/ricanwarfare/pi-portable/pull/5';
    const summary = openUpdate({ version: '1.4.0', branch: 'automation/pi-v1.4.0', repository: 'ricanwarfare/pi-portable', server: 'https://github.com',
      git: args => { assert.deepEqual(args.slice(0, 2), ['ls-remote', '--heads']); return 'existing remote commit'; },
      gh: args => { calls.push(args); return args[1] === 'list' ? JSON.stringify(hasPr ? [{ url }] : []) : url; } });
    assert.ok(summary.includes(url));
    assert.equal(calls.filter(args => args[1] === 'create').length, hasPr ? 0 : 1);
  }
});
const publication = () => ({ version: '1.4.0', pin: '1.4.0', changelog: '# Changelog\n\n## 1.4.0\n\n- Update.\n', commit, refs: [], releases: [] });
test('one-click publication creates a matching immutable tag then explicitly dispatches the tested release workflow', () => {
  const calls = [];
  assert.equal(publish({ ...publication(), gh: args => calls.push(args) }), 'v1.4.0');
  assert.deepEqual(calls, [
    ['api', '--method', 'POST', 'repos/{owner}/{repo}/git/refs', '-f', 'ref=refs/tags/v1.4.0', '-f', `sha=${commit}`],
    ['workflow', 'run', 'windows.yml', '--ref', 'v1.4.0'],
  ]);
});
test('publication retries same-source failed builds but refuses different/annotated tags and existing releases/drafts', () => {
  const calls = [];
  const options = { ...publication(), refs: [{ ref: 'refs/tags/v1.4.0', object: { type: 'commit', sha: commit } }], gh: args => calls.push(args) };
  publish(options);
  assert.equal(calls.length, 1);
  for (const override of [
    { refs: [{ ref: 'refs/tags/v1.4.0', object: { type: 'commit', sha: 'b'.repeat(40) } }] },
    { refs: [{ ref: 'refs/tags/v1.4.0', object: { type: 'tag', sha: commit } }] },
    { releases: [{ tag_name: 'v1.4.0', draft: true }] },
    { releases: [{ tag_name: 'v1.4.0', draft: false }] },
    { commit: 'invalid' },
  ]) assert.throws(() => publish({ ...options, ...override, gh: () => assert.fail('Must not write anything') }));
  assert.throws(() => releaseTag('1.4.0', '1.3.0', options.changelog), /must match/);
  assert.throws(() => releaseTag('1.4.0', '1.4.0', '# Changelog'), /changelog/);
});

test('this repository keeps every release file aligned with the bundled Pi pin', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const read = name => readFileSync(join(root, name), 'utf8');
  const pin = JSON.parse(read('upstream-release.json'));
  const version = JSON.parse(read('version.json')).version;
  const escaped = version.replaceAll('.', '\\.');
  assert.equal(version, pin.version, 'version.json and upstream-release.json must name the same version');
  assert.match(read('README.md'), new RegExp(`Release \\*\\*${escaped}\\*\\* bundles the official \\*\\*Pi ${escaped}\\*\\* executable\\.`));
  assert.match(read('THIRD_PARTY_NOTICES.md'), new RegExp(`\\| Pi coding agent \\| ${escaped}, `));
  const changelog = read('CHANGELOG.md');
  const sections = changelog.split(/^##\s+/m).filter(part => part.startsWith(`${version}\n`) || part.startsWith(`${version}\r\n`));
  assert.equal(sections.length, 1, 'changelog must have exactly one section for the pinned version');
  assert.ok(sections[0].split(/\r?\n/).slice(1).join('\n').trim().length > 0, 'the release section must not be empty');
  assert.equal(releaseTag(version, pin.version, changelog), `v${version}`);
});
