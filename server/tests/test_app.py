import json
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient
from cryptography.fernet import Fernet

from server.app import ROOT, Settings, create_app, initialize_database
from server.passwords import hash_password
from server.state import default_state, inventory_operation, migrate_state


class AppTests(unittest.TestCase):
    def setUp(self) -> None:
        self.database_path = ROOT / '.test-tea.sqlite3'
        self.database_path.unlink(missing_ok=True)
        self.addCleanup(self.database_path.unlink, missing_ok=True)
        self.settings = Settings(
            password_hash=hash_password('correct horse battery staple'),
            database_path=self.database_path,
            cookie_secure=False,
            app_environment='development',
            allowed_origin='http://testserver',
            encryption_key=Fernet.generate_key().decode('ascii'),
        )
        self.client = TestClient(create_app(self.settings))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def test_health_is_public_no_store_204(self) -> None:
        response = self.client.get('/api/healthz')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_state_requires_login_and_session_cookie_is_protected(self) -> None:
        self.assertEqual(self.client.get('/api/state').status_code, 401)
        denied = self.client.post('/api/login', json={'password': 'wrong'})
        self.assertEqual(denied.status_code, 401)

        response = self.client.post('/api/login', json={'password': 'correct horse battery staple'})
        self.assertEqual(response.status_code, 200)
        cookie = response.headers['set-cookie'].lower()
        self.assertIn('httponly', cookie)
        self.assertIn('samesite=lax', cookie)
        self.assertNotIn('secure', cookie)
        session_response = self.client.get('/api/session')
        self.assertTrue(session_response.json()['authenticated'])
        self.assertEqual(session_response.headers['cache-control'], 'no-store')

        state_response = self.client.get('/api/state')
        self.assertEqual(state_response.status_code, 200)
        body = state_response.json()
        self.assertEqual(body['revision'], 0)
        self.assertEqual(len(body['state']['teaLibrary']), 89)
        self.assertEqual(state_response.headers['cache-control'], 'no-store')
        self.assertNotIn('password', json.dumps(body).lower())
        self.assertNotIn('apiKey', body['state']['llm'])

        self.assertEqual(self.client.post('/api/logout').status_code, 200)
        self.assertFalse(self.client.get('/api/session').json()['authenticated'])
        self.assertEqual(self.client.get('/api/state').status_code, 401)

    def test_login_rejects_untrusted_origin(self) -> None:
        response = self.client.post(
            '/api/login',
            json={'password': 'correct horse battery staple'},
            headers={'Origin': 'https://example.invalid'},
        )
        self.assertEqual(response.status_code, 403)

    def test_production_cookie_sets_secure_flag(self) -> None:
        secure_settings = Settings(
            password_hash=self.settings.password_hash,
            database_path=self.database_path,
            cookie_secure=True,
            app_environment='production',
            allowed_origin='http://testserver',
        )
        with TestClient(create_app(secure_settings)) as client:
            response = client.post('/api/login', json={'password': 'correct horse battery staple'})
        cookie = response.headers['set-cookie'].lower()
        self.assertIn('secure', cookie)
        self.assertIn('httponly', cookie)
        self.assertIn('samesite=lax', cookie)

    def test_seed_counts_and_restart_preserves_state(self) -> None:
        with closing(sqlite3.connect(self.database_path)) as db:
            row = db.execute('SELECT revision, payload FROM app_state WHERE id = 1').fetchone()
        self.assertEqual(row[0], 0)
        state = json.loads(row[1])
        self.assertEqual(len(state['teaLibrary']), 89)
        catalog = json.loads((ROOT / 'seed.json').read_text(encoding='utf-8'))['knowledgeCatalog']
        self.assertEqual(catalog['expectedTeaCount'], 89)
        self.assertEqual(len(catalog['teas']), 86)
        self.assertEqual(catalog['withheldTeaIds'], [0, 25, 68])

        state['profile'] = {'city': '苏州'}
        state['teaLibrary'][0]['name'] = '用户修改的茶名'
        with closing(sqlite3.connect(self.database_path)) as db:
            db.execute(
                'UPDATE app_state SET revision = 4, payload = ? WHERE id = 1',
                (json.dumps(state, ensure_ascii=False),),
            )
            db.commit()

        initialize_database(self.database_path)
        with closing(sqlite3.connect(self.database_path)) as db:
            after = db.execute('SELECT revision, payload FROM app_state WHERE id = 1').fetchone()
        self.assertEqual(after[0], 4)
        self.assertEqual(json.loads(after[1])['profile']['city'], '苏州')
        self.assertEqual(json.loads(after[1])['teaLibrary'][0]['name'], '用户修改的茶名')

    def test_login_rate_limit_after_five_failures(self) -> None:
        for _ in range(5):
            self.assertEqual(self.client.post('/api/login', json={'password': 'wrong'}).status_code, 401)
        self.assertEqual(self.client.post('/api/login', json={'password': 'wrong'}).status_code, 429)

    def login(self) -> None:
        self.assertEqual(self.client.post('/api/login', json={'password': 'correct horse battery staple'}).status_code, 200)

    def test_section_patch_is_validated_revisioned_and_persistent_after_restart(self) -> None:
        self.assertEqual(self.client.patch('/api/state/profile', json={'baseRevision': 0, 'value': {'city': '苏州'}}).status_code, 401)
        self.assertEqual(self.client.post('/api/mutations', json={'baseRevision': 0, 'mutations': [
            {'mutationId': 'unauth', 'type': 'upsert_history', 'entityId': 'h', 'value': {}}]}).status_code, 401)
        self.login()
        self.assertEqual(self.client.patch('/api/state/settings', json={'baseRevision': 0, 'value': {'avoidDays': 0}}).status_code, 422)
        self.assertEqual(self.client.patch('/api/state/settings', json={'baseRevision': 0, 'value': {'avoidDays': True}}).status_code, 422)
        self.assertEqual(self.client.patch('/api/state/llm', json={'baseRevision': 0, 'value': {'endpoint': 7}}).status_code, 422)
        saved = self.client.patch('/api/state/profile', json={'baseRevision': 0, 'value': {
            'gender': '', 'age': '', 'city': '苏州', 'constitution': None, 'quizAnswers': {}}})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()['revision'], 1)
        self.assertEqual(self.client.patch('/api/state/settings', json={'baseRevision': 0, 'value': {'avoidDays': 4}}).status_code, 409)
        self.client.__exit__(None, None, None)
        with TestClient(create_app(self.settings)) as restarted:
            restarted.post('/api/login', json={'password': 'correct horse battery staple'})
            state = restarted.get('/api/state').json()
            self.assertEqual(state['revision'], 1)
            self.assertEqual(state['state']['profile']['city'], '苏州')

    def test_ai_key_is_encrypted_separate_and_never_returned(self) -> None:
        self.login()
        secret = 'test-only-not-a-real-provider-key'
        response = self.client.patch('/api/state/llm', json={'baseRevision': 0, 'value': {
            'enabled': True, 'endpoint': 'https://example.invalid/v1', 'apiKey': secret}})
        self.assertEqual(response.status_code, 200)
        body = self.client.get('/api/state').json()
        self.assertTrue(body['state']['llm']['apiKeyConfigured'])
        self.assertNotIn(secret, json.dumps(body))
        self.assertNotIn('apiKey', body['state']['llm'])
        with closing(sqlite3.connect(self.database_path)) as db:
            ciphertext = db.execute('SELECT ciphertext FROM secrets WHERE name="llm_api_key"').fetchone()[0]
            payload = db.execute('SELECT payload FROM app_state WHERE id=1').fetchone()[0]
        self.assertNotIn(secret, ciphertext)
        self.assertNotIn(secret, payload)

    def test_knowledge_base_override_keeps_previous_backup_and_rejects_invalid(self) -> None:
        self.login()
        self.assertEqual(self.client.patch('/api/state/knowledgeBase', json={'baseRevision': 0, 'value': {}}).status_code, 422)
        default = self.client.get('/api/state').json()['state']['knowledgeBase']
        custom = dict(default)
        custom['catalogVersion'] = 'personal-v2'
        profiles = dict(default['profilesByTeaId'])
        profile = dict(profiles['1'])
        origin = dict(profile['origin'])
        origin['region'] = {'value': None, 'status': 'unknown', 'sourceType': 'unknown', 'confidence': 0, 'updatedAt': 123}
        profile['origin'] = origin
        profile['research'] = dict(profile['research'])
        fields = sum(len(section) for name, section in profile.items() if name in {
            'identity', 'origin', 'craft', 'sensory', 'effects', 'context', 'brew'})
        known = sum(1 for name in ('identity', 'origin', 'craft', 'sensory', 'effects', 'context', 'brew')
                    for field in profile[name].values() if field.get('value') is not None)
        profile['research']['completeness'] = round(known / fields, 4)
        profiles['1'] = profile
        custom['profilesByTeaId'] = profiles
        response = self.client.patch('/api/state/knowledgeBase', json={'baseRevision': 0, 'value': custom})
        self.assertEqual(response.status_code, 200)
        state = self.client.get('/api/state').json()['state']
        self.assertEqual(state['knowledgeBase']['catalogVersion'], 'personal-v2')
        self.assertIsNone(state['knowledgeBase']['profilesByTeaId']['1']['origin']['region']['value'])
        self.assertEqual(state['knowledgeBaseBackup']['catalogVersion'], default['catalogVersion'])
        malformed = dict(state['knowledgeBase'])
        profiles = dict(malformed['profilesByTeaId'])
        bad_profile = dict(profiles['1'])
        bad_origin = dict(bad_profile['origin'])
        bad_origin['region'] = {'value': [], 'status': 'personal', 'sourceType': 'user', 'confidence': 1, 'updatedAt': 124}
        bad_profile['origin'] = bad_origin
        profiles['1'] = bad_profile
        malformed['profilesByTeaId'] = profiles
        self.assertEqual(self.client.patch('/api/state/knowledgeBase', json={'baseRevision': 1, 'value': malformed}).status_code, 422)
        completed = json.loads(json.dumps(state['knowledgeBase']))
        completed['profilesByTeaId']['0'] = json.loads(json.dumps(default['profilesByTeaId']['1']))
        completed['profilesByTeaId']['0']['teaId'] = 0
        completed['withheldTeaIds'].remove(0)
        completed['validationSummary']['profileCount'] = 87
        self.assertEqual(self.client.patch('/api/state/knowledgeBase', json={
            'baseRevision': 1, 'value': completed}).status_code, 200)
        self.assertEqual(len(self.client.get('/api/state').json()['state']['knowledgeBase']['profilesByTeaId']), 87)

    def test_knowledge_override_contract_and_tea_references(self) -> None:
        self.login()
        valid_field = {'value': ['花香'], 'status': 'personal', 'sourceType': 'user',
                       'confidence': 1, 'updatedAt': 10}
        good = {'teaId': 1, 'patch': {'sensory.aromaTags': valid_field},
                'lockedPaths': ['sensory.aromaTags'], 'tombstones': {}, 'updatedAt': 10}
        self.assertEqual(self.client.patch('/api/state/knowledgeOverrides', json={'baseRevision': 0,
                         'value': {'1': good}}).status_code, 200)
        bad_path = {'teaId': 1, 'patch': {'missing.path': valid_field},
                    'lockedPaths': [], 'tombstones': {}, 'updatedAt': 10}
        self.assertEqual(self.client.patch('/api/state/knowledgeOverrides', json={'baseRevision': 1,
                         'value': {'1': bad_path}}).status_code, 422)
        bad_value = {'teaId': 1, 'patch': {'identity.year': {
            'value': 2200, 'status': 'confirmed', 'sourceType': 'user', 'confidence': 1, 'updatedAt': 11}},
            'lockedPaths': [], 'tombstones': {}, 'updatedAt': 11}
        self.assertEqual(self.client.patch('/api/state/knowledgeOverrides', json={'baseRevision': 1,
                         'value': {'1': bad_value}}).status_code, 422)
        bad_scale = {'teaId': 1, 'patch': {'sensory.sweetness': {
            'value': 8, 'status': 'personal', 'sourceType': 'user', 'confidence': 1, 'updatedAt': 11}},
            'lockedPaths': [], 'tombstones': {}, 'updatedAt': 11}
        self.assertEqual(self.client.patch('/api/state/knowledgeOverrides', json={'baseRevision': 1,
                         'value': {'1': bad_scale}}).status_code, 422)
        unknown_tea = {'teaId': 999, 'patch': {'sensory.aromaTags': valid_field},
                       'lockedPaths': [], 'tombstones': {}, 'updatedAt': 11}
        self.assertEqual(self.client.patch('/api/state/knowledgeOverrides', json={'baseRevision': 1,
                         'value': {'999': unknown_tea}}).status_code, 422)

    def test_mutations_update_history_and_avoid_atomically_and_dedupe(self) -> None:
        self.login()
        mutation = {'mutationId': 'm-1', 'type': 'upsert_history', 'entityId': 'h-1',
                    'value': {'id': 'h-1', 'date': '2026-09-23', 'teaId': 1, 'type': 'primary'}}
        avoid = {'mutationId': 'm-2', 'type': 'set_avoid', 'entityId': '1',
                 'value': {'active': True, 'updatedAt': 123}}
        response = self.client.post('/api/mutations', json={'baseRevision': 0, 'mutations': [mutation, avoid]})
        self.assertEqual(response.status_code, 200)
        repeated = self.client.post('/api/mutations', json={'baseRevision': 0, 'mutations': [mutation]})
        self.assertTrue(repeated.json()['results'][0]['duplicate'])
        self.assertEqual(repeated.json()['revision'], 1)
        mixed_stale = self.client.post('/api/mutations', json={'baseRevision': 0, 'mutations': [mutation, {
            'mutationId': 'new-stale', 'type': 'upsert_history', 'entityId': 'h-2',
            'value': {'id': 'h-2', 'date': '2026-09-23', 'teaId': 2, 'type': 'primary'}}]})
        self.assertEqual(mixed_stale.status_code, 409)
        state = self.client.get('/api/state').json()['state']
        self.assertEqual(len(state['history']), 1)
        self.assertTrue(state['temporaryAvoids']['1']['active'])
        self.assertEqual(self.client.post('/api/mutations', json={'baseRevision': 1, 'mutations': [
            {'mutationId': 'bad', 'type': 'unknown', 'entityId': 'x', 'value': {}}]}).status_code, 422)

    def test_version_one_migration_and_inventory_full_lifecycle(self) -> None:
        seed = json.loads((ROOT / 'seed.json').read_text(encoding='utf-8'))
        old = {'teaLibrary': seed['teas'], 'profile': {'city': '杭州'}, 'llm': {'apiKey': 'legacy'}}
        upgraded = migrate_state(old, seed)
        self.assertEqual(upgraded['schemaVersion'], 2)
        self.assertEqual(upgraded['profile']['city'], '杭州')
        self.assertNotIn('apiKey', upgraded['llm'])
        old['apiKey'] = 'must-not-survive'
        self.assertNotIn('apiKey', migrate_state(old, seed))
        malformed = default_state(seed)
        malformed['teaLibrary'][0]['id'] = []
        from server.state import validate_state
        with self.assertRaises(ValueError):
            validate_state(malformed, seed)
        malformed = default_state(seed)
        malformed['knowledgeOverrides']['1'] = {'teaId': 1, 'patch': []}
        with self.assertRaises(ValueError):
            validate_state(malformed, seed)
        malformed = default_state(seed)
        malformed['inventory'] = [{'id': 'done', 'teaId': 1, 'packageType': 'retail', 'status': 'finished',
                                   'quantity': 1, 'updatedAt': 1, 'remainingSessions': 1}]
        with self.assertRaises(ValueError):
            validate_state(malformed, seed)
        rows = [{'id': 'sealed-1', 'teaId': 1, 'packageType': 'retail', 'packageLabel': '100g',
                 'status': 'sealed', 'quantity': 2, 'netWeightPerUnit': 100, 'remainingSessions': 2, 'updatedAt': 1}]
        state = default_state(seed)
        state['inventory'] = rows
        validate_state(state, seed)
        rows, opened = inventory_operation(rows, 'open', 'sealed-1', now=10)
        self.assertEqual(rows[0]['quantity'], 1)
        self.assertEqual(opened['status'], 'opened')
        state['inventory'] = rows
        validate_state(state, seed)
        rows, consumed = inventory_operation(rows, 'consume', opened['id'], now=11)
        self.assertEqual(consumed['remainingSessions'], 1)
        state['inventory'] = rows
        validate_state(state, seed)
        rows, consumed = inventory_operation(rows, 'consume', opened['id'], now=12)
        self.assertEqual(consumed['status'], 'finished')
        state['inventory'] = rows
        validate_state(state, seed)
        rows, finished = inventory_operation(rows, 'delete', opened['id'], now=13)
        self.assertEqual(finished['deletedAt'], 13)
        state['inventory'] = rows
        validate_state(state, seed)

    def test_database_migration_encrypts_legacy_key_and_preserves_revision(self) -> None:
        path = ROOT / '.test-v1-migration.sqlite3'
        path.unlink(missing_ok=True)
        self.addCleanup(path.unlink, missing_ok=True)
        old_state = {'teaLibrary': json.loads((ROOT / 'seed.json').read_text(encoding='utf-8'))['teas'],
                     'llm': {'apiKey': 'legacy-test-only-key'}, 'history': []}
        with closing(sqlite3.connect(path)) as db:
            db.execute('CREATE TABLE app_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)')
            db.execute('INSERT INTO app_state VALUES (1, 9, ?)', (json.dumps(old_state),))
            db.commit()
        encryption_key = Fernet.generate_key().decode('ascii')
        initialize_database(path, encryption_key=encryption_key)
        with closing(sqlite3.connect(path)) as db:
            revision, payload = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
            ciphertext = db.execute('SELECT ciphertext FROM secrets WHERE name="llm_api_key"').fetchone()[0]
        self.assertEqual(revision, 9)
        self.assertNotIn('legacy-test-only-key', payload)
        self.assertEqual(Fernet(encryption_key.encode('ascii')).decrypt(ciphertext.encode('ascii')).decode('utf-8'),
                         'legacy-test-only-key')

    def test_invalid_encryption_key_fails_with_actionable_configuration_error(self) -> None:
        with self.assertRaisesRegex(RuntimeError, 'APP_ENCRYPTION_KEY must be a valid Fernet key'):
            Settings(password_hash='', database_path=self.database_path, cookie_secure=False,
                     app_environment='development', encryption_key='placeholder')


if __name__ == '__main__':
    unittest.main()
