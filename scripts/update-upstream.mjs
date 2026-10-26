import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const upstream = 'earendil-works/pi';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function versionParts(version) {
  if (typeof version !== 'string' || version.trim() !== version || !versionPattern.test(version)) throw new Error('Expected a stable major.minor.patch version');
  const parts = version.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part) || part > 65534)) throw new Error('Version exceeds Windows assembly limits');
  return parts;
}
export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function selectRelease(release) {
  if (release.draft !== false || release.prerelease !== false || !/^v/.test(release.tag_name)) throw new Error('Expected a published stable release');
  const version = release.tag_name.slice(1);
  versionParts(version);
  const url = `https://github.com/${upstream}/releases/tag/v${version}`;
  if (release.html_url !== url || !Number.isSafeInteger(release.id) || release.id <= 0 || !Number.isFinite(Date.parse(release.published_at))) throw new Error('Invalid official release identity');
  const assets = release.assets?.filter(asset => asset.name === 'pi-windows-x64.zip');
  if (assets?.length !== 1) throw new Error('Expected exactly one Windows x64 ZIP');
  const asset = assets[0];
  const download = `https://github.com/${upstream}/releases/download/v${version}/pi-windows-x64.zip`;
  if (asset.browser_download_url !== download || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 512 * 1024 * 1024 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error('Invalid Windows asset URL, size or SHA256 digest');
  return { version, url: download, sha256: asset.digest.slice(7), size: asset.size,
    release: { id: release.id, url, publishedAt: release.published_at } };
}
// The download is never executed. A bounded streamed hash verifies the GitHub asset digest.
// No GitHub/model credential is sent to the public download or redirect targets.
export async function verifyAsset(candidate, fetcher = fetch) {
  const response = await fetcher(candidate.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Windows download failed (${response.status})`);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > candidate.size) throw new Error('Windows asset exceeds declared size');
    hash.update(chunk);
  }
  if (size !== candidate.size || hash.digest('hex') !== candidate.sha256) throw new Error('Windows asset checksum/size mismatch');
}
export function prepareUpdate(files, candidate) {
  const pin = JSON.parse(files['upstream-release.json']);
  const distribution = JSON.parse(files['version.json']);
  const direction = compareVersions(candidate.version, pin.version);
  if (direction < 0) throw new Error('Refusing upstream downgrade');
  if (direction === 0) {
    if (pin.sha256 !== candidate.sha256 || pin.url !== candidate.url) throw new Error('Upstream changed an already pinned release; review manually');
    return null;
  }
  if (compareVersions(candidate.version, distribution.version) <= 0) throw new Error('New upstream version must exceed the distribution version');
  const oldIntro = `Release **${distribution.version}** bundles the official **Pi ${pin.version}** executable.`;
  if (!files['README.md'].includes(oldIntro)) throw new Error('README version marker missing; review manually');
  const oldNotices = `| Pi coding agent | ${pin.version}, `;
  if (!files['THIRD_PARTY_NOTICES.md'].includes(oldNotices)) throw new Error('Third-party notices version marker missing; review manually');
  const entry = `## ${candidate.version}\n\n- Update the unmodified official Windows x64 Pi runtime from ${pin.version} to ${candidate.version}, keeping the portable version aligned.\n- Verify the downloaded ZIP against GitHub's SHA256 asset digest and retain the existing tool/extension pins and portable defaults.\n- See [upstream release notes](${candidate.release.url}) for Pi changes. Full Windows build, offline/internal-network, settings, credential, web and delegation tests are required before publication.\n\n`;
  if (!files['CHANGELOG.md'].startsWith('# Changelog\n') && !files['CHANGELOG.md'].startsWith('# Changelog\r\n')) throw new Error('Changelog heading missing');
  if (new RegExp(`^## ${candidate.version.replaceAll('.', '\\.')}\\s*$`, 'm').test(files['CHANGELOG.md'])) throw new Error('Changelog version already exists; review manually');
  return {
    'upstream-release.json': JSON.stringify({ ...pin, version: candidate.version, url: candidate.url, sha256: candidate.sha256, release: candidate.release }, null, 2) + '\n',
    'version.json': JSON.stringify({ ...distribution, version: candidate.version }) + '\n',
    'README.md': files['README.md'].replace(oldIntro, `Release **${candidate.version}** bundles the official **Pi ${candidate.version}** executable.`),
    'THIRD_PARTY_NOTICES.md': files['THIRD_PARTY_NOTICES.md'].replace(oldNotices, `| Pi coding agent | ${candidate.version}, `),
    'CHANGELOG.md': files['CHANGELOG.md'].replace(/^# Changelog\r?\n\s*/, '# Changelog\n\n' + entry),
  };
}

export async function runUpdate(root, release, { check = false, fetcher = fetch } = {}) {
  const candidate = selectRelease(release);
  const names = ['upstream-release.json', 'version.json', 'README.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md'];
  const files = Object.fromEntries(names.map(name => [name, readFileSync(join(root, name), 'utf8')]));
  const changes = prepareUpdate(files, candidate);
  if (!changes) return { changed: false, version: candidate.version };
  await verifyAsset(candidate, fetcher);
  if (!check) for (const [name, content] of Object.entries(changes)) writeFileSync(join(root, name), content);
  return { changed: true, version: candidate.version, branch: `automation/pi-v${candidate.version}`, releaseUrl: candidate.release.url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/update-upstream.mjs [--check]');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const release = JSON.parse(execFileSync('gh', ['api', `repos/${upstream}/releases/latest`], { encoding: 'utf8', timeout: 30_000 }));
    const result = await runUpdate(root, release, { check: args.includes('--check') });
    console.log(result.changed ? `Verified upstream Pi ${result.version}${args.includes('--check') ? ' (check only)' : '; update prepared'}.` : `Already current: Pi ${result.version}.`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
    if (result.changed) {
      mkdirSync(join(root, '.build'), { recursive: true });
      writeFileSync(join(root, '.build/upstream-pr.md'), `Update Pi Portable to **${result.version}**, matching [upstream Pi](${result.releaseUrl}).\n\nThe Windows ZIP was downloaded and its bytes verified against GitHub's published SHA256 asset digest. Tool and extension pins, credentials, state defaults and network policy are unchanged.\n\nThe Windows build/test workflow is dispatched explicitly on this branch; check its result under Actions before merging. Review upstream changes for SDK/extension compatibility. After merge, run **Actions → Publish release → Run workflow** on main to build, test and publish the matching version.\n`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
