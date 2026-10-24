import copy
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path

from server.app import ROOT, SEED
from server.data_management import parse_pwa_export, prepare_knowledge_install, snapshot_database
from server.state import default_state


class DataManagementTests(unittest.TestCase):
    def test_current_pwa_export_round_trip_excludes_key_status(self):
        state = default_state(SEED)
        exported = copy.deepcopy(state)
        exported['llm']['apiKeyConfigured'] = True
        parsed = parse_pwa_export({'format': 'tea-pwa-v1', 'state': exported}, SEED)
        self.assertEqual(parsed, state)
        self.assertNotIn('apiKeyConfigured', parsed['llm'])

    def test_old_or_partial_export_is_rejected(self):
        state = default_state(SEED)
        with self.assertRaises(ValueError):
            parse_pwa_export({'format': 'mini-program', 'state': state}, SEED)
        partial = copy.deepcopy(state)
        partial.pop('inventory')
        with self.assertRaises(ValueError):
            parse_pwa_export({'format': 'tea-pwa-v1', 'state': partial}, SEED)
        partial = copy.deepcopy(state)
        partial['llm']['apiKey'] = 'do-not-import'
        with self.assertRaises(ValueError):
            parse_pwa_export({'format': 'tea-pwa-v1', 'state': partial}, SEED)

    def test_invalid_knowledge_package_cannot_change_state(self):
        original = default_state(SEED)
        with self.assertRaises(ValueError):
            prepare_knowledge_install({'purpose': 'import', 'teas': []}, original, SEED)
        self.assertIsNone(original['knowledgeBase'])

    def test_complete_knowledge_package_preserves_previous_baseline(self):
        original = default_state(SEED)
        catalog = copy.deepcopy(SEED['knowledgeCatalog'])
        known = {profile['teaId'] for profile in catalog['teas']}
        for tea in SEED['teas']:
            if tea['id'] not in known:
                profile = copy.deepcopy(catalog['teas'][0])
                profile['teaId'] = tea['id']
                catalog['teas'].append(profile)
        catalog['purpose'] = 'import'
        catalog['expectedTeaCount'] = len(SEED['teas'])
        catalog['withheldTeaIds'] = []
        next_state = prepare_knowledge_install(catalog, original, SEED)
        self.assertEqual(next_state['knowledgeBase']['validationSummary']['profileCount'], len(SEED['teas']))
        self.assertEqual(next_state['knowledgeBaseBackup']['validationSummary']['profileCount'], len(SEED['knowledgeCatalog']['teas']))
        self.assertIsNone(original['knowledgeBase'])

    def test_sqlite_snapshot_preserves_data(self):
        test_dir = ROOT / '.test-runtime'
        test_dir.mkdir(exist_ok=True)
        database_path = test_dir / 'data-management.sqlite3'
        database_path.unlink(missing_ok=True)
        backup_path = None
        try:
            with closing(sqlite3.connect(database_path)) as db:
                db.execute('CREATE TABLE sample (value TEXT)')
                db.execute('INSERT INTO sample(value) VALUES (?)', ('before',))
                db.commit()
            backup_path = snapshot_database(database_path)
            with closing(sqlite3.connect(database_path)) as db:
                db.execute('UPDATE sample SET value=?', ('after',))
                db.commit()
            with closing(sqlite3.connect(backup_path)) as backup:
                self.assertEqual(backup.execute('SELECT value FROM sample').fetchone()[0], 'before')
        finally:
            database_path.unlink(missing_ok=True)
            if backup_path is not None:
                backup_path.unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
