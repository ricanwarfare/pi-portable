import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionParts } from './update-upstream.mjs';

export function openUpdate({ version, branch, repository, server, git, gh }) {
  versionParts(version);
  if (branch !== `automation/pi-v${version}` || !/^[\w.-]+\/[\w.-]+$/.test(repository) || server !== 'https://github.com') throw new Error('Invalid update branch/repository');
  if (!git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]).trim()) {
    git(['switch', '-c', branch]);
    git(['add', 'upstream-release.json', 'version.json', 'README.md', 'CHANGELOG.md']);
    git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', `Update bundled Pi to ${version}`]);
    git(['push', 'origin', branch]);
  }
  const existing = JSON.parse(gh(['pr', 'list', '--head', branch, '--base', 'main', '--state', 'open', '--json', 'url']));
  let message;
  if (existing.length) message = existing[0].url;
  else {
    try {
      message = gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', `Update Pi Portable to ${version}`, '--body-file', '.build/upstream-pr.md']).trim();
    } catch (error) {
      if (!/GitHub Actions is not permitted to create or approve pull requests/i.test(String(error.stderr))) throw error;
      message = `GitHub blocks bot-created PRs. [Open the prepared update PR](${server}/${repository}/compare/main...${branch}?expand=1)`;
    }
  }
  // Bot pushes/PR events are insufficient: explicitly dispatch the read-only build.
  gh(['workflow', 'run', 'windows.yml', '--ref', branch]);
  return message + '\n\nCheck the branch commit under Actions → Windows build and release before merging.\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = name => args => execFileSync(name, args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const summary = openUpdate({ version: process.env.UPDATE_VERSION, branch: process.env.UPDATE_BRANCH,
      repository: process.env.GH_REPO, server: process.env.GITHUB_SERVER_URL, git: command('git'), gh: command('gh') });
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
