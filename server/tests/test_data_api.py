import copy
import json
import time
import unittest
from pathlib import Path

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from server.app import ROOT, Settings, create_app
from server.passwords import hash_password


class DataApiTests(unittest.TestCase):
    def setUp(self):
        test_dir = ROOT / '.test-runtime'
        test_dir.mkdir(exist_ok=True)
        self.database_path = test_dir / 'data-api.sqlite3'
        self.database_path.unlink(missing_ok=True)
        self.backup_dir = test_dir / 'backups'
        self.existing_backups = set(self.backup_dir.glob('tea-before-change-*.sqlite3')) if self.backup_dir.exists() else set()
        settings = Settings(
            password_hash=hash_password('step4-test-password'), database_path=self.database_path,
            cookie_secure=False, app_environment='development', allowed_origin='http://testserver',
            encryption_key=Fernet.generate_key().decode('ascii'),
        )
        self.client = TestClient(create_app(settings))
        self.client.__enter__()
        self.client.post('/api/login', json={'password': 'step4-test-password'})

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.database_path.unlink(missing_ok=True)
        if self.backup_dir.exists():
            for backup in set(self.backup_dir.glob('tea-before-change-*.sqlite3')) - self.existing_backups:
                backup.unlink(missing_ok=True)

    @staticmethod
    def origin():
        return {'Origin': 'http://testserver'}

    def state(self):
        return self.client.get('/api/state').json()

    def test_import_requires_own_format_and_safety_snapshot_then_reset(self):
        initial = self.state()
        exported = copy.deepcopy(initial['state'])
        exported['profile']['city'] = '成都'
        invalid = self.client.post('/api/data/import', json={
            'baseRevision': initial['revision'], 'data': {'format': 'old', 'state': exported},
        }, headers=self.origin())
        self.assertEqual(invalid.status_code, 422)
        denied = self.client.post('/api/data/import', json={
            'baseRevision': initial['revision'], 'data': {'format': 'tea-pwa-v1', 'state': exported},
        })
        self.assertEqual(denied.status_code, 403)
        accepted = self.client.post('/api/data/import', json={
            'baseRevision': initial['revision'], 'data': {'format': 'tea-pwa-v1', 'state': exported},
        }, headers=self.origin())
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(self.state()['state']['profile']['city'], '成都')
        self.assertEqual(len(set(self.backup_dir.glob('tea-before-change-*.sqlite3')) - self.existing_backups), 1)
        reset = self.client.post('/api/data/reset', json={'baseRevision': accepted.json()['revision']}, headers=self.origin())
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertEqual(self.state()['state']['profile']['city'], '')
        self.assertEqual(len(set(self.backup_dir.glob('tea-before-change-*.sqlite3')) - self.existing_backups), 2)

    def test_library_delete_cascades_personal_override_and_tombstones_inventory(self):
        first = self.state()
        tea_id = first['state']['teaLibrary'][-1]['id']
        stamp = int(time.time() * 1000)
        override = {str(tea_id): {'teaId': tea_id, 'patch': {}, 'lockedPaths': [], 'tombstones': {}, 'updatedAt': stamp}}
        saved = self.client.patch('/api/state/knowledgeOverrides', json={
            'baseRevision': first['revision'], 'value': override,
        }, headers=self.origin())
        self.assertEqual(saved.status_code, 200, saved.text)
        inventory = [{'id': 'inv-test', 'teaId': tea_id, 'packageType': 'retail', 'status': 'sealed', 'quantity': 1, 'updatedAt': stamp}]
        saved = self.client.patch('/api/state/inventory', json={
            'baseRevision': saved.json()['revision'], 'value': inventory,
        }, headers=self.origin())
        self.assertEqual(saved.status_code, 200, saved.text)
        library = [tea for tea in first['state']['teaLibrary'] if tea['id'] != tea_id]
        saved = self.client.patch('/api/state/teaLibrary', json={
            'baseRevision': saved.json()['revision'], 'value': library,
        }, headers=self.origin())
        self.assertEqual(saved.status_code, 200, saved.text)
        current = self.state()['state']
        self.assertNotIn(str(tea_id), current['knowledgeOverrides'])
        self.assertGreater(current['inventory'][0]['deletedAt'], 0)
        self.assertGreater(current['teaLibraryUpdatedAt'], 0)

    def test_invalid_knowledge_package_does_not_replace_baseline(self):
        before = self.state()
        result = self.client.post('/api/knowledge/install', json={
            'baseRevision': before['revision'], 'catalog': {'purpose': 'import', 'teas': []},
        }, headers=self.origin())
        self.assertEqual(result.status_code, 422)
        self.assertEqual(self.state()['revision'], before['revision'])


if __name__ == '__main__':
    unittest.main()
