"""Updater safety and idempotency tests. No GitHub writes or network calls."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('updater', ROOT / 'scripts/update-upstream.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def release(version='1.4.0'):
    payloads = {'pi-windows-x64.zip': b'windows fixture', 'pi-linux-x64.tar.gz': b'linux fixture'}
    payloads['SHA256SUMS'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in payloads.items()).encode()
    result = {'tag_name': 'v' + version, 'draft': False, 'prerelease': False, 'id': 42,
              'html_url': f'https://github.com/earendil-works/pi/releases/tag/v{version}', 'published_at': '2026-10-16T13:00:00Z', 'assets': []}
    for name, data in payloads.items():
        result['assets'].append({'name': name, 'size': len(data), 'digest': 'sha256:' + hashlib.sha256(data).hexdigest(),
                                'browser_download_url': f'https://github.com/earendil-works/pi/releases/download/v{version}/{name}'})
    return result, payloads


class UpdateTests(unittest.TestCase):
    def setUp(self):
        (ROOT / '.build').mkdir(exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix='pi-updater-', dir=ROOT / '.build'))
        for file in [*updater.PIN_FILES.values(), 'README.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']:
            (self.root / file).write_bytes((ROOT / file).read_bytes())
        data, _ = release('1.3.0')
        _, assets = updater.release_assets(data)
        for name, file in updater.PIN_FILES.items():
            pin = json.loads((self.root / file).read_text())
            pin['sha256'] = assets[name]['digest'][7:]
            (self.root / file).write_text(json.dumps(pin))

    def test_update_preserves_tools_and_changes_only_expected_files(self):
        old = json.loads((self.root / 'upstream-release.json').read_text())
        data, _ = release()
        changes, version, _ = updater.plan_update(self.root, data)
        self.assertEqual(version, '1.4.0')
        self.assertEqual(set(changes), {'upstream-release.json', 'upstream-linux-release.json', 'README.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md'})
        pin = json.loads(changes['upstream-release.json'])
        self.assertEqual(pin['tools'], old['tools'])
        self.assertEqual(pin['release']['id'], 42)
        self.assertIn('| Upstream Pi | 1.4.0 |', changes['README.md'])
        self.assertIn('## Unreleased', changes['CHANGELOG.md'])
        self.assertNotIn('version.json', changes)

    def test_provenance_refresh_then_noop(self):
        data, _ = release('1.3.0')
        changes, _, _ = updater.plan_update(self.root, data)
        self.assertEqual(set(changes), set(updater.PIN_FILES.values()))
        for file, content in changes.items():
            (self.root / file).write_text(content)
        self.assertEqual(updater.plan_update(self.root, data)[0], {})

    def test_rejects_unstable_missing_or_untrusted_assets(self):
        original, _ = release()
        mutations = [lambda r: r.update(prerelease=True), lambda r: r.update(tag_name='v1.4.0-beta'),
                     lambda r: r['assets'].pop(), lambda r: r['assets'][0].update(digest=None),
                     lambda r: r['assets'][0].update(browser_download_url='https://example.com/untrusted'),
                     lambda r: r['assets'].append(copy.deepcopy(r['assets'][0]))]
        for mutate in mutations:
            data = copy.deepcopy(original)
            mutate(data)
            with self.assertRaises(ValueError):
                updater.plan_update(self.root, data)

    def test_no_downgrade_and_no_silent_same_version_hash_change(self):
        data, _ = release('1.2.0')
        self.assertEqual(updater.plan_update(self.root, data)[0], {})
        data, _ = release('1.3.0')
        data['assets'][0]['digest'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(ValueError, 'without a version change'):
            updater.plan_update(self.root, data)

    def test_downloads_require_both_checksums_and_correct_bytes(self):
        data, payloads = release()
        _, assets = updater.release_assets(data)
        fetch = lambda asset: payloads[asset['name']]
        updater.verify_assets(assets, fetch)
        payloads['pi-linux-x64.tar.gz'] += b'changed'
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            updater.verify_assets(assets, fetch)
        data, payloads = release()
        _, assets = updater.release_assets(data)
        payloads['SHA256SUMS'] = b'not the published checksums'
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            updater.verify_assets(assets, fetch)

    def test_existing_open_pr_is_preserved_and_closed_pr_not_recreated(self):
        data, _ = release()
        opened = {'state': 'OPEN', 'url': 'https://github.com/example/repo/pull/1', 'headRefOid': 'abc', 'isCrossRepository': False}
        with patch.object(updater, 'gh_json', return_value=[opened]), patch.object(updater, 'ensure_validation') as validate, patch.object(updater, 'verify_assets') as download:
            self.assertEqual(updater.publish(self.root, 'example/repo', data), opened['url'])
            validate.assert_called_once()
            download.assert_not_called()
        with patch.object(updater, 'gh_json', return_value=[{**opened, 'state': 'CLOSED'}]), patch.object(updater, 'run') as run:
            self.assertIsNone(updater.publish(self.root, 'example/repo', data))
            run.assert_not_called()

    def test_ci_is_explicitly_dispatched_with_workflow_event_filter(self):
        with patch.object(updater, 'gh_json', return_value=[]) as listing, patch.object(updater, 'run') as run:
            updater.ensure_validation('example/repo', 'codex/update-pi-1.4.0', 'abc')
            self.assertIn('workflow_dispatch', listing.call_args.args)
            run.assert_called_once_with('gh', 'workflow', 'run', 'windows.yml', '--repo', 'example/repo', '--ref', 'codex/update-pi-1.4.0')

    def test_disabled_repository_setting_does_not_leave_orphan_branch(self):
        data, _ = release()
        with patch.object(updater, 'gh_json', side_effect=[[], {'can_approve_pull_request_reviews': False}]), patch.object(updater, 'run') as run:
            self.assertIsNone(updater.publish(self.root, 'example/repo', data))
            run.assert_not_called()

    def test_limited_token_does_not_require_administration_permission(self):
        data, _ = release()
        denied = subprocess.CalledProcessError(1, ['gh', 'api'], output='{"status":"403"}')
        with patch.object(updater, 'gh_json', side_effect=[[], denied]), patch.object(updater, 'run', return_value='dirty checkout'):
            with self.assertRaisesRegex(ValueError, 'clean checkout'):
                updater.publish(self.root, 'example/repo', data)


if __name__ == '__main__':
    unittest.main()
