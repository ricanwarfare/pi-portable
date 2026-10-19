import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionParts } from './update-upstream.mjs';

export function releaseTag(version, pin, changelog) {
  versionParts(version);
  if (version !== pin) throw new Error('Portable and upstream versions must match');
  if (!new RegExp(`^## ${version.replaceAll('.', '\\.')}\\s*$`, 'm').test(changelog)) throw new Error('Missing release changelog');
  return `v${version}`;
}
// Never move or replace an existing tag/release. A failed build can be retried
// only for the same tagged source; fixes need a deliberate new version/tag decision.
export function publish({ version, pin, changelog, commit, refs, releases, gh }) {
  const tag = releaseTag(version, pin, changelog);
  if (typeof commit !== 'string' || commit.length !== 40 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release commit');
  if (releases.some(release => release.tag_name === tag)) throw new Error(`${tag} already has a release (including drafts); nothing was overwritten`);
  const existing = refs.find(ref => ref.ref === `refs/tags/${tag}`);
  if (existing && (existing.object.type !== 'commit' || existing.object.sha !== commit)) throw new Error('Existing tag points to different source; refusing to move it');
  if (!existing) gh(['api', '--method', 'POST', 'repos/{owner}/{repo}/git/refs', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`]);
  gh(['workflow', 'run', 'windows.yml', '--ref', tag]);
  return tag;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publish release must run on main');
    const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 30_000 });
    const root = new URL('../', import.meta.url);
    const read = name => readFileSync(new URL(name, root), 'utf8');
    const pages = endpoint => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/${endpoint}`])).flat();
    const tag = publish({ version: JSON.parse(read('version.json')).version, pin: JSON.parse(read('upstream-release.json')).version,
      changelog: read('CHANGELOG.md'), commit: process.env.GITHUB_SHA,
      refs: pages('git/matching-refs/tags/v'), releases: pages('releases?per_page=100'), gh });
    const message = `Dispatched the Windows build/test/release gate for ${tag}. Publication occurs only if that workflow succeeds.`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
