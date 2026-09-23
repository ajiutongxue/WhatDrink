import json
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import ROOT, Settings, create_app, initialize_database
from server.passwords import hash_password


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


if __name__ == '__main__':
    unittest.main()
