"""Propose verified upstream Pi pins. Never merges, tags, or publishes binaries."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM = 'earendil-works/pi'
PIN_FILES = {'pi-windows-x64.zip': 'upstream-release.json', 'pi-linux-x64.tar.gz': 'upstream-linux-release.json'}


def version_tuple(value):
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value):
        raise ValueError(f'Expected a stable major.minor.patch version: {value}')
    return tuple(map(int, value.split('.')))


def release_assets(release):
    tag = release.get('tag_name', '')
    if not tag.startswith('v') or release.get('draft') or release.get('prerelease'):
        raise ValueError('Only published stable vX.Y.Z releases are eligible.')
    version_tuple(tag[1:])
    url = f'https://github.com/{UPSTREAM}/releases/tag/{tag}'
    if release.get('html_url') != url or not isinstance(release.get('id'), int):
        raise ValueError('Unexpected upstream release identity.')
    assets = {}
    for name in [*PIN_FILES, 'SHA256SUMS']:
        matches = [a for a in release.get('assets', []) if a.get('name') == name]
        if len(matches) != 1:
            raise ValueError(f'Missing or duplicate required release asset: {name}')
        asset = matches[0]
        if asset.get('browser_download_url') != f'https://github.com/{UPSTREAM}/releases/download/{tag}/{name}':
            raise ValueError(f'Unexpected asset URL: {name}')
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest') or ''):
            raise ValueError(f'Missing GitHub SHA-256 digest: {name}; review manually.')
        if not isinstance(asset.get('size'), int) or not 0 < asset['size'] <= 512 * 1024 * 1024:
            raise ValueError(f'Invalid asset size: {name}')
        assets[name] = asset
    return tag[1:], assets


def replace_once(text, pattern, replacement):
    updated, count = re.subn(pattern, lambda _: replacement, text, flags=re.MULTILINE)
    if count != 1:
        raise ValueError('Expected exactly one documented upstream version; review formatting manually.')
    return updated


def plan_update(root, release):
    version, assets = release_assets(release)
    pins = {name: json.loads((root / file).read_text(encoding='utf-8')) for name, file in PIN_FILES.items()}
    current = {pin['version'] for pin in pins.values()}
    if len(current) != 1:
        raise ValueError('Windows and Linux upstream versions disagree; review manually.')
    old = current.pop()
    if version_tuple(version) < version_tuple(old):
        return {}, version, assets
    changes = {}
    for name, file in PIN_FILES.items():
        pin = pins[name]
        sha = assets[name]['digest'].removeprefix('sha256:')
        if version == old and pin['sha256'] != sha:
            raise ValueError('A pinned release asset changed without a version change; review manually.')
        proposed = {**pin, 'version': version, 'url': assets[name]['browser_download_url'], 'sha256': sha,
                    'release': {'id': release['id'], 'url': release['html_url'], 'publishedAt': release.get('published_at')}}
        if proposed != pin:
            changes[file] = json.dumps(proposed, indent=2) + '\n'
    if version != old:
        readme = (root / 'README.md').read_text(encoding='utf-8')
        changes['README.md'] = replace_once(readme, rf'^\| Upstream Pi \| {re.escape(old)} \|$', f'| Upstream Pi | {version} |')
        notices = (root / 'THIRD_PARTY_NOTICES.md').read_text(encoding='utf-8')
        changes['THIRD_PARTY_NOTICES.md'] = replace_once(notices, rf'^\| Pi coding agent \| {re.escape(old)} \|.*$',
            f'| Pi coding agent | {version} | [earendil-works/pi](https://github.com/earendil-works/pi) | MIT; retained in [NOTICE.txt](NOTICE.txt) |')
        changelog = (root / 'CHANGELOG.md').read_text(encoding='utf-8')
        entry = f'- Update bundled Pi from {old} to {version}; retain portable launchers, IR tools, provider settings, and web controls.\n'
        if '## Unreleased\n' in changelog:
            changes['CHANGELOG.md'] = changelog.replace('## Unreleased\n', '## Unreleased\n\n' + entry, 1)
        else:
            changes['CHANGELOG.md'] = replace_once(changelog, r'^Wrapper versions are independent of upstream Pi versions\.$',
                'Wrapper versions are independent of upstream Pi versions.\n\n## Unreleased\n\n' + entry)
    return changes, version, assets


def download(asset):
    request = urllib.request.Request(asset['browser_download_url'], headers={'User-Agent': 'pi-portable-updater'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read(asset['size'] + 1)
    return data


def verify_assets(assets, fetch=download):
    sums = fetch(assets['SHA256SUMS'])
    def verify(name, data):
        asset = assets[name]
        if len(data) != asset['size'] or hashlib.sha256(data).hexdigest() != asset['digest'][7:]:
            raise ValueError(f'Download size/SHA-256 mismatch: {name}')
    verify('SHA256SUMS', sums)
    lines = sums.decode('utf-8').splitlines()
    for name in PIN_FILES:
        matches = [re.fullmatch(r'([0-9a-f]{64})\s+\*?' + re.escape(name), line) for line in lines]
        hashes = [match[1] for match in matches if match]
        if hashes != [assets[name]['digest'][7:]]:
            raise ValueError(f'SHA256SUMS disagrees with GitHub asset digest: {name}')
        verify(name, fetch(assets[name]))


def run(*args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def gh_json(*args):
    return json.loads(run('gh', *args))


def ensure_validation(repo, branch, sha):
    runs = gh_json('run', 'list', '--repo', repo, '--workflow', 'windows.yml', '--branch', branch,
                   '--commit', sha, '--event', 'workflow_dispatch', '--limit', '10', '--json', 'databaseId,status,url')
    if not runs:
        run('gh', 'workflow', 'run', 'windows.yml', '--repo', repo, '--ref', branch)
        print('Dispatched Windows and Ubuntu validation for', sha)
    else:
        print('Existing validation:', runs[0]['url'])


def publish(root, repo, release):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repo):
        raise ValueError('Invalid repository name.')
    changes, version, assets = plan_update(root, release)
    if not changes:
        print('Upstream Pi is current; no update PR needed.')
        return None
    branch = f'codex/update-pi-{version}'
    prs = gh_json('pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--limit', '100',
                  '--json', 'number,state,url,headRefOid,isCrossRepository')
    prs = [pr for pr in prs if pr.get('isCrossRepository') is False]
    if prs:
        opened = next((pr for pr in prs if pr['state'] == 'OPEN'), None)
        if opened:
            print('Keeping existing update PR and human edits:', opened['url'])
            ensure_validation(repo, branch, opened['headRefOid'])
            return opened['url']
        print('An update PR for this version was already closed/merged; no duplicate:', prs[0]['url'])
        return None
    try:
        permissions = gh_json('api', f'repos/{repo}/actions/permissions/workflow')
    except subprocess.CalledProcessError as error:
        # GITHUB_TOKEN can create PRs but cannot read this administration setting.
        # Do not grant admin access just for a preflight; GitHub enforces creation itself.
        try:
            status = str(json.loads(error.output).get('status'))
        except (ValueError, TypeError):
            raise error
        if status != '403':
            raise
        permissions = None
        print('Admin settings are not readable by this token; GitHub will enforce PR-creation permission.')
    if permissions is not None and not permissions.get('can_approve_pull_request_reviews'):
        print('PR creation is disabled in repository Actions settings; no branch was created. Enable the combined create/approve PR setting before publishing proposals.')
        return None
    if run('git', 'status', '--porcelain', cwd=root):
        raise ValueError('Publish requires a clean checkout.')
    remote_branches = run('git', 'ls-remote', '--heads', 'origin', f'refs/heads/{branch}', cwd=root)
    if remote_branches:
        raise ValueError('Update branch already exists without a PR; review manually rather than overwriting it.')
    verify_assets(assets)
    base = gh_json('repo', 'view', repo, '--json', 'defaultBranchRef')['defaultBranchRef']['name']
    if run('git', 'branch', '--show-current', cwd=root) != base:
        raise ValueError('Publish must start on the repository default branch.')
    run('git', 'switch', '-c', branch, cwd=root)
    for file, content in changes.items():
        (root / file).write_text(content, encoding='utf-8', newline='\n')
    run('git', 'config', 'user.name', 'github-actions[bot]', cwd=root)
    run('git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com', cwd=root)
    run('git', 'add', '--', *changes.keys(), cwd=root)
    run('git', 'commit', '-m', f'chore: refresh upstream Pi {version} pins', cwd=root)
    sha = run('git', 'rev-parse', 'HEAD', cwd=root)
    run('git', 'push', 'origin', f'HEAD:refs/heads/{branch}', cwd=root)
    body = root / '.build/upstream-pr.md'
    body.parent.mkdir(exist_ok=True)
    body.write_text(f'Prepare the portable distribution for [upstream Pi {version}]({release["html_url"]}). '
        'Both release archives were downloaded and checked against GitHub asset SHA-256 digests and the published SHA256SUMS. '
        'The first provenance-only refresh may keep the existing Pi version.\n\n'
        f'Commit: `{sha}`. Changes: ' + ', '.join(f'`{file}`' for file in changes) + '.\n\n'
        'Windows and both Ubuntu validation jobs are dispatched explicitly on this branch; see the commit checks and Actions tab. '
        'No merge, approval, tag, or binary publication is automated. Review upstream release notes and compatibility, then bump the wrapper version and prepare release notes before publishing a new portable release. '
        'Search-tool and pi-web-search pins are unchanged.\n', encoding='utf-8')
    url = run('gh', 'pr', 'create', '--repo', repo, '--head', branch, '--base', base, '--draft',
              '--title', f'chore: refresh upstream Pi {version}', '--body-file', str(body), cwd=root)
    print('Update PR:', url)
    ensure_validation(repo, branch, sha)
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true', help='Create a draft PR and dispatch CI; otherwise check without writes.')
    args = parser.parse_args()
    release = gh_json('api', f'repos/{UPSTREAM}/releases/latest')
    if args.publish:
        url = publish(ROOT, os.environ.get('GITHUB_REPOSITORY', 'ricanwarfare/pi-portable'), release)
        if url and os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
                summary.write(f'Upstream update PR: {url}\n')
    else:
        changes, version, assets = plan_update(ROOT, release)
        if changes:
            verify_assets(assets)
        print(json.dumps({'upstreamVersion': version, 'changedFiles': list(changes), 'verifiedDownloads': bool(changes)}, indent=2))


if __name__ == '__main__':
    main()
