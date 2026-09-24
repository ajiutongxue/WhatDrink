import json
import sqlite3
import unittest
from contextlib import closing
from unittest.mock import AsyncMock, patch
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from cryptography.fernet import Fernet

from server.app import ROOT, Settings, _apply_model_options, _build_public_chat_url, create_app, initialize_database
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
            amap_key='test-only-amap-key',
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

    def test_weather_requires_login_and_uses_coordinate_reverse_geocode(self) -> None:
        self.assertEqual(self.client.get('/api/weather?city=苏州').status_code, 401)
        self.login()
        calls: list[tuple[str, dict[str, str]]] = []

        async def fake_amap(path: str, params: dict[str, str]) -> dict[str, object]:
            calls.append((path, params))
            if path == '/v3/geocode/regeo':
                return {'status': '1', 'regeocode': {'addressComponent': {
                    'city': '上海市', 'adcode': '310100'}}}
            if path == '/v3/weather/weatherInfo':
                return {'status': '1', 'lives': [{'temperature': '23', 'humidity': '61',
                    'weather': '多云', 'winddirection': '东风', 'windpower': '≤3',
                    'reporttime': '2026-09-24 10:00:00'}]}
            raise AssertionError(f'unexpected AMap path: {path}')

        with patch('server.app._amap_get_json', new=AsyncMock(side_effect=fake_amap)):
            response = self.client.get('/api/weather?city=苏州&latitude=31.2&longitude=121.5')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json(), {'success': True, 'data': {
            'temp': 23, 'feelsLike': 23, 'humidity': 61, 'desc': '多云', 'wind': 0,
            'winddirection': '东风', 'windpower': '≤3', 'city': '上海市',
            'reporttime': '2026-09-24 10:00:00'}})
        self.assertEqual([path for path, _ in calls], [
            '/v3/geocode/regeo', '/v3/weather/weatherInfo'])
        self.assertEqual(calls[0][1]['location'], '121.5,31.2')
        self.assertEqual(calls[1][1]['city'], '310100')
        self.assertNotIn('test-only-amap-key', response.text)

    def test_weather_falls_back_to_profile_then_requested_city(self) -> None:
        self.login()
        self.assertEqual(self.client.patch('/api/state/profile', json={
            'baseRevision': 0, 'value': {'city': '苏州'}}).status_code, 200)
        calls: list[tuple[str, dict[str, str]]] = []

        async def fake_amap(path: str, params: dict[str, str]) -> dict[str, object]:
            calls.append((path, params))
            if path == '/v3/geocode/regeo':
                return {'status': '0'}
            if path == '/v3/geocode/geo':
                return {'status': '1', 'geocodes': [{'adcode': '320500'}]}
            if path == '/v3/weather/weatherInfo':
                return {'status': '1', 'lives': [{'temperature': '18', 'humidity': '70'}]}
            raise AssertionError(f'unexpected AMap path: {path}')

        with patch('server.app._amap_get_json', new=AsyncMock(side_effect=fake_amap)):
            profile_city = self.client.get('/api/weather?city=南京&latitude=0&longitude=0')
        self.assertTrue(profile_city.json()['success'])
        self.assertEqual(profile_city.json()['data']['city'], '苏州')
        self.assertEqual(calls[1][1]['address'], '苏州')

        self.assertEqual(self.client.patch('/api/state/profile', json={
            'baseRevision': 1, 'value': {'city': ''}}).status_code, 200)
        calls.clear()
        with patch('server.app._amap_get_json', new=AsyncMock(side_effect=fake_amap)):
            requested_city = self.client.get('/api/weather?city=南京&latitude=0&longitude=0')
        self.assertTrue(requested_city.json()['success'])
        self.assertEqual(requested_city.json()['data']['city'], '南京')
        self.assertEqual(calls[1][1]['address'], '南京')

    def test_weather_failure_is_non_sensitive_and_recoverable(self) -> None:
        self.login()

        async def fail_amap(path: str, params: dict[str, str]) -> dict[str, object]:
            raise httpx.TimeoutException('provider URL included sensitive details')

        with patch('server.app._amap_get_json', new=AsyncMock(side_effect=fail_amap)):
            response = self.client.get('/api/weather?city=苏州')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['success'], False)
        self.assertNotIn('test-only-amap-key', response.text)
        self.assertNotIn('provider URL', response.text)

    def test_weather_without_amap_key_returns_recoverable_configuration_result(self) -> None:
        path = ROOT / '.test-weather-unconfigured.sqlite3'
        path.unlink(missing_ok=True)
        self.addCleanup(path.unlink, missing_ok=True)
        settings = Settings(
            password_hash=self.settings.password_hash,
            database_path=path,
            cookie_secure=False,
            app_environment='development',
            allowed_origin='http://testserver',
            amap_key='',
        )
        with TestClient(create_app(settings)) as client:
            client.post('/api/login', json={'password': 'correct horse battery staple'})
            response = client.get('/api/weather?city=苏州')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'success': False, 'error': 'Weather service is not configured'})

    def _save_ai_config(self, *, api_key: str | None = 'test-only-ai-key', rec_model: str = 'rec-model') -> None:
        value: dict[str, object] = {
            'enabled': True, 'parserEnabled': True, 'noteAnalysisEnabled': True,
            'endpoint': 'https://api.openai.com/v1', 'parserModel': 'parser-model',
            'recModel': rec_model,
        }
        if api_key is not None:
            value['apiKey'] = api_key
        response = self.client.patch('/api/state/llm', json={'baseRevision': 0, 'value': value})
        self.assertEqual(response.status_code, 200)

    def test_ai_chat_requires_login_same_origin_and_rejects_client_url_or_key(self) -> None:
        body = {'purpose': 'quote', 'messages': [{'role': 'user', 'content': '写一句茶语'}]}
        self.assertEqual(self.client.post('/api/ai/chat', json=body,
                         headers={'Origin': 'http://testserver'}).status_code, 401)
        self.login()
        self.assertEqual(self.client.post('/api/ai/chat', json=body).status_code, 403)
        hostile = {**body, 'apiKey': 'must-not-echo', 'url': 'https://127.0.0.1'}
        rejected = self.client.post('/api/ai/chat', json=hostile,
                                    headers={'Origin': 'http://testserver'})
        self.assertEqual(rejected.status_code, 422)
        self.assertNotIn('must-not-echo', rejected.text)

        too_long = self.client.post('/api/ai/chat', json={
            'purpose': 'quote', 'messages': [{'role': 'user', 'content': 'x' * 16_001}]},
            headers={'Origin': 'http://testserver'})
        self.assertEqual(too_long.status_code, 422)
        too_large = self.client.post('/api/ai/chat', content=b'{' + b' ' * (64 * 1024) + b'}',
            headers={'Origin': 'http://testserver', 'Content-Type': 'application/json'})
        self.assertEqual(too_large.status_code, 413)

    def test_ai_chat_uses_saved_models_and_returns_only_content(self) -> None:
        self.login()
        self._save_ai_config()
        calls: list[dict[str, object]] = []

        async def fake_post(url: str, api_key: str, payload: dict[str, object]) -> httpx.Response:
            self.assertEqual(api_key, 'test-only-ai-key')
            calls.append(payload)
            return httpx.Response(200, json={'choices': [{'message': {'content': '模型回复'}}]})

        purposes = [
            ('parse', 'parser-model'), ('note', 'parser-model'),
            ('recommend', 'rec-model'), ('coarse', 'rec-model'), ('quote', 'rec-model'),
        ]
        with (patch('server.app._validated_chat_url', new=AsyncMock(
                return_value='https://api.openai.com/v1/chat/completions')),
              patch('server.app._post_ai_chat', new=AsyncMock(side_effect=fake_post))):
            for purpose, _ in purposes:
                response = self.client.post('/api/ai/chat', json={
                    'purpose': purpose,
                    'messages': [{'role': 'user', 'content': 'test prompt'}],
                    'maxTokens': 55,
                }, headers={'Origin': 'http://testserver'})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), {'content': '模型回复'})
                self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual([call['model'] for call in calls], [model for _, model in purposes])
        self.assertTrue(all(call['max_tokens'] == 55 for call in calls))
        self.assertEqual([call['temperature'] for call in calls], [0.1, 0.1, 0.5, 0.5, 0.85])
        self.assertNotIn('apiKey', json.dumps(calls))

    def test_ai_model_options_match_existing_provider_behavior(self) -> None:
        qwen: dict[str, object] = {}
        _apply_model_options(qwen, 'parse', 'qwen-plus', 'https://dashscope.aliyuncs.com/v1')
        self.assertEqual(qwen, {'temperature': 0.1, 'enable_thinking': False})
        deepseek: dict[str, object] = {}
        _apply_model_options(deepseek, 'recommend', 'deepseek-v4-pro', 'https://api.deepseek.com/v1')
        self.assertEqual(deepseek, {'temperature': 0.5, 'thinking': {'type': 'disabled'}})
        thinking_only: dict[str, object] = {}
        _apply_model_options(thinking_only, 'quote', 'qwen3.7-max-preview', 'https://dashscope.aliyuncs.com/v1')
        self.assertEqual(thinking_only, {'temperature': 0.85})

    def test_ai_chat_quote_falls_back_to_parser_model_and_private_endpoint_is_blocked(self) -> None:
        self.login()
        self._save_ai_config(rec_model='')
        with (patch('server.app._validated_chat_url', new=AsyncMock(
                return_value='https://api.openai.com/v1/chat/completions')),
              patch('server.app._post_ai_chat', new=AsyncMock(return_value=httpx.Response(
                  200, json={'choices': [{'message': {'content': '茶语'}}]}))) as post):
            response = self.client.post('/api/ai/chat', json={
                'purpose': 'quote', 'messages': [{'role': 'user', 'content': 'test'}]},
                headers={'Origin': 'http://testserver'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(post.await_args.args[2]['model'], 'parser-model')
        with self.assertRaisesRegex(ValueError, 'public'):
            _build_public_chat_url('https://127.0.0.1/v1')

    def test_ai_chat_configuration_and_provider_errors_do_not_leak_secrets(self) -> None:
        self.login()
        self._save_ai_config(api_key=None)
        body = {'purpose': 'recommend', 'messages': [{'role': 'user', 'content': 'test'}]}
        headers = {'Origin': 'http://testserver'}
        missing_key = self.client.post('/api/ai/chat', json=body, headers=headers)
        self.assertEqual(missing_key.status_code, 503)
        self.assertEqual(missing_key.json()['detail']['code'], 'ai_key_not_configured')
        self.assertNotIn('test-only-ai-key', missing_key.text)

        self.assertEqual(self.client.patch('/api/state/llm', json={'baseRevision': 1, 'value': {
            'enabled': True, 'parserEnabled': True, 'noteAnalysisEnabled': True,
            'endpoint': 'https://api.openai.com/v1', 'parserModel': 'parser-model',
            'recModel': 'rec-model', 'apiKey': 'test-only-ai-key'}}).status_code, 200)
        with (patch('server.app._validated_chat_url', new=AsyncMock(
                return_value='https://api.openai.com/v1/chat/completions')),
              patch('server.app._post_ai_chat', new=AsyncMock(return_value=httpx.Response(
                  401, json={'error': {'message': 'test-only-ai-key'}})))):
            provider_error = self.client.post('/api/ai/chat', json=body, headers=headers)
        self.assertEqual(provider_error.status_code, 502)
        self.assertEqual(provider_error.json()['detail']['code'], 'ai_provider_auth_failed')
        self.assertNotIn('test-only-ai-key', provider_error.text)

        state = self.client.get('/api/state').json()['state']
        self.assertTrue(state['llm']['apiKeyConfigured'])
        self.assertNotIn('test-only-ai-key', json.dumps(state))
        self.assertNotIn('apiKey', state['llm'])

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
