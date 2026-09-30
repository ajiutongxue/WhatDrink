import contextlib
import copy
import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet

from server.app import ROOT as SERVER_ROOT, SEED, initialize_database
from server.data_management import LegacyImportError, import_legacy_database, parse_legacy_export
from server.legacy_import import main as legacy_import_main
from server.state import default_state


def _legacy_fixture():
    state = default_state(SEED)
    catalog = SEED['knowledgeCatalog']
    profiles = {str(profile['teaId']): copy.deepcopy(profile) for profile in catalog['teas']}
    state['knowledgeBase'] = {
        'schemaVersion': catalog['schemaVersion'],
        'catalogVersion': catalog['catalogVersion'],
        'sourceGeneratedAt': catalog.get('generatedAt'),
        'importedAt': 0,
        'profilesByTeaId': profiles,
        'withheldTeaIds': copy.deepcopy(catalog.get('withheldTeaIds', [])),
        'validationSummary': {
            'profileCount': len(profiles),
            'expectedTeaCount': catalog['expectedTeaCount'],
        },
    }
    state['llm']['apiKey'] = 'step6-secret-canary'
    state['history'] = [{
        'id': 'h_step6_1', 'updatedAt': 1000, 'date': '2026-09-28', 'teaId': 1,
        'teaName': state['teaLibrary'][0]['name'], 'type': 'primary',
        'tastingNotes': '清甜回甘', 'imageFileIDs': [{'fileID': 'cloud://old/image-1', 'caption': '春茶'}],
    }]
    state['temporaryAvoids'] = {'2': {'active': True, 'markedAt': 1000, 'expiresAt': 2_592_001_000, 'updatedAt': 1000}}
    state['knowledgeOverrides'] = {'1': {'teaId': 1, 'patch': {}, 'lockedPaths': [], 'tombstones': {}, 'updatedAt': 1000}}
    state['inventory'] = [{
        'id': 'inv_step6_1', 'teaId': 1, 'packageType': 'retail', 'status': 'sealed',
        'quantity': 1, 'updatedAt': 1000, 'note': '测试库存',
    }]
    state.pop('schemaVersion')
    state.pop('knowledgeBaseBackup')
    return state


class LegacyImportTests(unittest.TestCase):
    def setUp(self):
        self.runtime_root = SERVER_ROOT / '.test-runtime'
        self.runtime_root.mkdir(exist_ok=True)
        self.temp_context = tempfile.TemporaryDirectory(prefix='step6-import-', dir=self.runtime_root)
        self.temp_dir = Path(self.temp_context.name)
        self.database_path = self.temp_dir / 'tea.sqlite3'
        self.encryption_key = Fernet.generate_key().decode('ascii')
        initialize_database(self.database_path, encryption_key=self.encryption_key)

    def tearDown(self):
        self.temp_context.cleanup()

    def _prepared(self):
        return parse_legacy_export(_legacy_fixture(), SEED)

    def test_normal_legacy_export_translates_counts_and_lists_ignored_images(self):
        state, key, report = self._prepared()
        self.assertEqual(key, 'step6-secret-canary')
        self.assertNotIn('apiKey', state['llm'])
        self.assertEqual(report['counts']['teaLibrary'], 89)
        self.assertEqual(report['counts']['history'], 1)
        self.assertEqual(report['counts']['temporaryAvoids'], 1)
        self.assertEqual(report['counts']['inventory'], 1)
        self.assertEqual(report['counts']['knowledgeOverrides'], 1)
        self.assertEqual(report['ignoredImageFileIDs'][0]['fileID'], 'cloud://old/image-1')
        self.assertNotIn('imageFileIDs', state['history'][0])
        self.assertEqual(state['history'][0]['tastingNotes'], '清甜回甘')

    def test_missing_fields_wrong_wrapper_and_invalid_sections_are_rejected(self):
        value = _legacy_fixture()
        value.pop('inventory')
        with self.assertRaisesRegex(ValueError, 'missing required fields'):
            parse_legacy_export(value, SEED)
        with self.assertRaisesRegex(ValueError, 'raw tea_doctor_v1'):
            parse_legacy_export({'format': 'tea-pwa-v1', 'state': _legacy_fixture()}, SEED)
        value = _legacy_fixture()
        value['knowledgeOverrides'] = []
        with self.assertRaisesRegex(ValueError, 'knowledgeOverrides'):
            parse_legacy_export(value, SEED)

    def test_invalid_history_and_inventory_tea_references_are_rejected(self):
        value = _legacy_fixture()
        value['history'][0]['teaId'] = 99999
        value['history'][0].pop('teaName')
        with self.assertRaisesRegex(ValueError, 'unavailable tea'):
            parse_legacy_export(value, SEED)
        value = _legacy_fixture()
        value['inventory'][0]['teaId'] = 99999
        with self.assertRaisesRegex(ValueError, 'inventory\[0\]'):
            parse_legacy_export(value, SEED)

    def test_old_images_are_reported_and_removed_without_dropping_the_history(self):
        value = _legacy_fixture()
        value['history'][0]['imageFileIDs'].append('cloud://old/image-2')
        state, _, report = parse_legacy_export(value, SEED)
        self.assertEqual([item['fileID'] for item in report['ignoredImageFileIDs']],
                         ['cloud://old/image-1', 'cloud://old/image-2'])
        self.assertEqual(state['history'][0]['id'], 'h_step6_1')
        self.assertEqual(state['history'][0]['tastingNotes'], '清甜回甘')
        self.assertEqual(len(state['history']), 1)

    def test_dry_run_does_not_touch_input_or_create_database_and_never_prints_ai_key(self):
        source_path = self.temp_dir / 'source.json'
        source_bytes = json.dumps(_legacy_fixture(), ensure_ascii=False).encode('utf-8')
        value = json.loads(source_bytes)
        value['llm']['apiKey'] = 'step6-secret-canary'
        source_path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        before = source_path.read_bytes()
        missing_database = self.temp_dir / 'must-not-be-created.sqlite3'
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = legacy_import_main(['--input', str(source_path), '--database', str(missing_database)])
        report = json.loads(output.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual(report['mode'], 'dry-run')
        self.assertEqual(source_path.read_bytes(), before)
        self.assertFalse(missing_database.exists())
        self.assertNotIn('step6-secret-canary', output.getvalue())
        self.assertEqual(report['ignoredImageFileIDs'][0]['fileID'], 'cloud://old/image-1')

    def test_formal_import_snapshots_encrypts_key_and_blocks_repeat_without_flag(self):
        state, key, _ = self._prepared()
        result = import_legacy_database(self.database_path, state, key,
                                        hashlib.sha256(b'fixture').hexdigest(), SEED,
                                        self.encryption_key)
        self.assertTrue(Path(result['backupPath']).is_file())
        with contextlib.closing(sqlite3.connect(self.database_path)) as db:
            current = json.loads(db.execute('SELECT payload FROM app_state WHERE id=1').fetchone()[0])
            ciphertext = db.execute('SELECT ciphertext FROM secrets WHERE name="llm_api_key"').fetchone()[0]
            marker = db.execute('SELECT source_sha256 FROM legacy_import_status WHERE id=1').fetchone()[0]
        self.assertEqual(current['history'][0]['tastingNotes'], '清甜回甘')
        self.assertNotIn('apiKey', current['llm'])
        self.assertNotIn('step6-secret-canary', ciphertext)
        self.assertEqual(Fernet(self.encryption_key.encode('ascii')).decrypt(ciphertext.encode('ascii')).decode(), key)
        self.assertEqual(marker, hashlib.sha256(b'fixture').hexdigest())
        with self.assertRaisesRegex(LegacyImportError, 'already recorded'):
            import_legacy_database(self.database_path, state, key,
                                   hashlib.sha256(b'fixture').hexdigest(), SEED,
                                   self.encryption_key)
        repeated = import_legacy_database(self.database_path, state, key,
                                          hashlib.sha256(b'fixture').hexdigest(), SEED,
                                          self.encryption_key, allow_repeat=True)
        self.assertTrue(repeated['alreadyImported'])

    def test_key_import_without_server_encryption_key_fails_before_snapshot_or_write(self):
        state, key, _ = self._prepared()
        with contextlib.closing(sqlite3.connect(self.database_path)) as db:
            original = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
        with self.assertRaisesRegex(LegacyImportError, 'APP_ENCRYPTION_KEY is required'):
            import_legacy_database(self.database_path, state, key,
                                   hashlib.sha256(b'fixture').hexdigest(), SEED, '')
        with contextlib.closing(sqlite3.connect(self.database_path)) as db:
            after = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
            secret_count = db.execute('SELECT COUNT(*) FROM secrets').fetchone()[0]
        self.assertEqual(after, original)
        self.assertEqual(secret_count, 0)
        self.assertFalse((self.temp_dir / 'backups').exists())

    def test_failure_after_state_and_secret_writes_rolls_back_and_keeps_backup(self):
        old_key = Fernet(self.encryption_key.encode('ascii')).encrypt(b'old-secret').decode('ascii')
        with contextlib.closing(sqlite3.connect(self.database_path)) as db:
            original = json.loads(db.execute('SELECT payload FROM app_state WHERE id=1').fetchone()[0])
            original['profile']['city'] = '原有城市'
            db.execute('UPDATE app_state SET revision=7, payload=? WHERE id=1',
                       (json.dumps(original, ensure_ascii=False),))
            db.execute('INSERT INTO secrets(name, ciphertext) VALUES("llm_api_key", ?)', (old_key,))
            db.execute('CREATE TABLE legacy_import_status (id INTEGER PRIMARY KEY CHECK(id=1), source_sha256 TEXT NOT NULL, imported_at INTEGER NOT NULL)')
            db.execute("CREATE TRIGGER fail_legacy_marker BEFORE INSERT ON legacy_import_status BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
            db.commit()
        state, key, _ = self._prepared()
        with self.assertRaises(LegacyImportError) as caught:
            import_legacy_database(self.database_path, state, key,
                                   hashlib.sha256(b'fixture').hexdigest(), SEED,
                                   self.encryption_key)
        self.assertIsNotNone(caught.exception.backup_path)
        self.assertTrue(caught.exception.backup_path.is_file())
        with contextlib.closing(sqlite3.connect(self.database_path)) as db:
            current = json.loads(db.execute('SELECT payload FROM app_state WHERE id=1').fetchone()[0])
            current_key = db.execute('SELECT ciphertext FROM secrets WHERE name="llm_api_key"').fetchone()[0]
            marker_count = db.execute('SELECT COUNT(*) FROM legacy_import_status').fetchone()[0]
        self.assertEqual(current['profile']['city'], '原有城市')
        self.assertEqual(current_key, old_key)
        self.assertEqual(marker_count, 0)
        with contextlib.closing(sqlite3.connect(caught.exception.backup_path)) as backup:
            saved = json.loads(backup.execute('SELECT payload FROM app_state WHERE id=1').fetchone()[0])
        self.assertEqual(saved['profile']['city'], '原有城市')


if __name__ == '__main__':
    unittest.main()
