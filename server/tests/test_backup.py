import contextlib
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.fernet import Fernet

from server.app import ROOT as SERVER_ROOT, SEED, initialize_database
from server.backup import create_daily_backup, prune_backups, restore_drill
from server.passwords import hash_password
from server.state import default_state


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.runtime_root = SERVER_ROOT / '.test-runtime'
        self.runtime_root.mkdir(exist_ok=True)
        self.temp_context = tempfile.TemporaryDirectory(prefix='step6-backup-', dir=self.runtime_root)
        self.temp_dir = Path(self.temp_context.name)
        self.data_dir = self.temp_dir / 'data'
        self.database_path = self.data_dir / 'tea.sqlite3'
        self.uploads_path = self.database_path.with_suffix('.uploads')
        self.uploads_path.mkdir(parents=True)
        self.backup_root = self.data_dir / 'backups' / 'daily'
        self.environment_path = self.temp_dir / 'server.env'
        self.encryption_key = Fernet.generate_key().decode('ascii')
        self.environment_path.write_text(
            '\n'.join([
                'APP_ENV=development',
                f'APP_PASSWORD_HASH={hash_password("step6-restore-test-password")}',
                f'APP_ENCRYPTION_KEY={self.encryption_key}',
                'COOKIE_SECURE=false',
                'ALLOWED_ORIGIN=http://127.0.0.1:5173',
                f'DATA_DIR={self.data_dir}',
                '',
            ]), encoding='utf-8',
        )
        initialize_database(self.database_path, encryption_key=self.encryption_key)
        self.attachment_id = 'att_' + 'a' * 32
        self.history_id = 'h_step6_backup'
        self._populate_database()

    def tearDown(self):
        self.temp_context.cleanup()

    def _populate_database(self):
        state = default_state(SEED)
        state['history'] = [{
            'id': self.history_id, 'updatedAt': 1000, 'date': '2026-09-29', 'teaId': 1,
            'teaName': state['teaLibrary'][0]['name'], 'type': 'primary',
            'imageFileIDs': [{'fileID': self.attachment_id, 'caption': '恢复演练'}],
        }]
        with contextlib.closing(sqlite3.connect(self.database_path)) as db:
            db.execute('UPDATE app_state SET revision=4, payload=? WHERE id=1',
                       (json.dumps(state, ensure_ascii=False, separators=(',', ':')),))
            db.execute('INSERT INTO attachments(id, history_id, content_type, caption, created_at) VALUES(?, ?, ?, ?, ?)',
                       (self.attachment_id, self.history_id, 'image/jpeg', '恢复演练', 1000))
            ciphertext = Fernet(self.encryption_key.encode('ascii')).encrypt(b'step6-backup-secret').decode('ascii')
            db.execute('INSERT INTO secrets(name, ciphertext) VALUES("llm_api_key", ?)', (ciphertext,))
            db.commit()
        (self.uploads_path / f'{self.attachment_id}.jpg').write_bytes(b'private test image payload')

    def test_daily_backup_contains_sqlite_uploads_environment_and_prunes_only_old_daily_sets(self):
        now = datetime(2026, 9, 29, 3, 30, tzinfo=timezone.utc)
        self.backup_root.mkdir(parents=True)
        old = self.backup_root / 'tea-pwa-daily-old'
        recent = self.backup_root / 'tea-pwa-daily-recent'
        unrelated = self.backup_root / 'manual-before-change.sqlite3'
        old.mkdir(); recent.mkdir(); unrelated.write_text('keep', encoding='utf-8')
        old_stamp = (now - timedelta(days=31)).timestamp()
        os.utime(old, (old_stamp, old_stamp))
        recent_stamp = (now - timedelta(days=1)).timestamp()
        os.utime(recent, (recent_stamp, recent_stamp))

        result = create_daily_backup(self.database_path, self.uploads_path, self.environment_path,
                                     self.backup_root, now=now)
        backup = Path(result['backupPath'])
        self.assertTrue((backup / 'tea.sqlite3').is_file())
        self.assertTrue((backup / 'server.env').is_file())
        self.assertEqual((backup / 'tea.uploads' / f'{self.attachment_id}.jpg').read_bytes(),
                         b'private test image payload')
        self.assertEqual(result['manifest']['counts']['history'], 1)
        self.assertEqual(result['manifest']['attachments'], 1)
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(unrelated.exists())

    def test_restore_drill_checks_real_service_against_restored_copy_then_cleans_it(self):
        backup = create_daily_backup(self.database_path, self.uploads_path, self.environment_path,
                                     self.backup_root)
        result = restore_drill(Path(backup['backupPath']))
        self.assertTrue(result['ok'])
        self.assertEqual(result['sqliteIntegrity'], 'ok')
        self.assertTrue(result['countsMatchManifest'])
        self.assertTrue(result['uploadsVerified'])
        self.assertTrue(result['environmentVerified'])
        self.assertTrue(result['encryptedAIKeyDecrypts'])
        self.assertEqual(result['serviceHealthz'], 204)
        self.assertTrue(result['temporaryRestoreRemoved'])

    def test_backup_refuses_missing_attachment_and_does_not_leave_partial_backup(self):
        (self.uploads_path / f'{self.attachment_id}.jpg').unlink()
        with self.assertRaisesRegex(ValueError, 'attachment recorded'):
            create_daily_backup(self.database_path, self.uploads_path, self.environment_path, self.backup_root)
        self.assertFalse(self.backup_root.exists())


if __name__ == '__main__':
    unittest.main()
