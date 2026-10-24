"""Private, local SQLite and attachment backups plus a disposable restore drill."""

from __future__ import annotations

import argparse
from contextlib import closing
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

from cryptography.fernet import Fernet, InvalidToken
from dotenv import dotenv_values

from server.data_management import legacy_state_counts
from server.state import validate_state


ROOT = Path(__file__).resolve().parent.parent
BACKUP_FORMAT = 'tea-pwa-local-backup-v1'
RETENTION_DAYS = 30
ATTACHMENT_EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}


def _set_private(path: Path, *, directory: bool = False) -> None:
    if os.name != 'nt':
        path.chmod(0o700 if directory else 0o600)


def _reject_symlinks(root: Path) -> None:
    if root.is_symlink():
        raise ValueError('Backup source must not be a symbolic link')
    if root.is_dir():
        for item in root.rglob('*'):
            if item.is_symlink():
                raise ValueError('Backup source contains a symbolic link')


def _read_database(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    with closing(sqlite3.connect(path)) as db:
        check = db.execute('PRAGMA integrity_check').fetchone()
        if not check or check[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'app_state' not in tables:
            raise ValueError('SQLite database has no PWA state')
        row = db.execute('SELECT payload FROM app_state WHERE id=1').fetchone()
        if not row:
            raise ValueError('SQLite database has no PWA state row')
        state = json.loads(row[0])
        attachments = []
        if 'attachments' in tables:
            cursor = db.execute('SELECT id, history_id, content_type, deleted_at FROM attachments ORDER BY id')
            names = [column[0] for column in cursor.description]
            attachments = [dict(zip(names, row)) for row in cursor]
        secrets = []
        if 'secrets' in tables:
            cursor = db.execute('SELECT name, ciphertext FROM secrets WHERE name="llm_api_key"')
            names = [column[0] for column in cursor.description]
            secrets = [dict(zip(names, row)) for row in cursor]
    return state, attachments, secrets


def _attachment_path(uploads: Path, attachment: dict[str, Any]) -> Path:
    extension = ATTACHMENT_EXTENSIONS.get(attachment.get('content_type'))
    attachment_id = attachment.get('id')
    if not extension or not isinstance(attachment_id, str) or not re.fullmatch(r'att_[0-9a-f]{32}', attachment_id):
        raise ValueError('Attachment metadata is invalid')
    name = f'{attachment_id}.{extension}'
    return uploads / '.trash' / name if attachment.get('deleted_at') is not None else uploads / name


def _validate_backup_contents(database_path: Path, uploads_path: Path,
                              environment_path: Path, seed: dict[str, Any]) -> dict[str, Any]:
    state, attachments, secrets = _read_database(database_path)
    validate_state(state, seed)
    environment = dotenv_values(environment_path)
    encryption_key = environment.get('APP_ENCRYPTION_KEY')
    password_hash = environment.get('APP_PASSWORD_HASH')
    if not isinstance(encryption_key, str) or not encryption_key.strip():
        raise ValueError('Recovery environment is missing APP_ENCRYPTION_KEY')
    if not isinstance(password_hash, str) or not password_hash.strip():
        raise ValueError('Recovery environment is missing APP_PASSWORD_HASH')
    try:
        cipher = Fernet(encryption_key.encode('ascii'))
    except (ValueError, UnicodeEncodeError) as error:
        raise ValueError('Recovery environment has an invalid APP_ENCRYPTION_KEY') from error

    attachments_by_id = {attachment['id']: attachment for attachment in attachments}
    references: dict[str, list[str]] = {}
    for entry in state.get('history', []):
        if not isinstance(entry, dict):
            continue
        images = entry.get('imageFileIDs', [])
        if not isinstance(images, list):
            raise ValueError('A history attachment list is invalid')
        for image in images:
            if not isinstance(image, dict) or not isinstance(image.get('fileID'), str):
                raise ValueError('A history attachment reference is invalid')
            references.setdefault(image['fileID'], []).append(entry.get('id', ''))
    files_present = 0
    for attachment in attachments:
        expected = _attachment_path(uploads_path, attachment)
        if not expected.is_file():
            raise ValueError('An attachment recorded in SQLite is missing from the upload directory')
        files_present += 1
        linked_to = references.get(attachment['id'], [])
        if attachment.get('deleted_at') is None:
            if len(linked_to) != 1 or linked_to[0] != attachment.get('history_id'):
                raise ValueError('An active SQLite attachment has an invalid history link')
        elif linked_to:
            raise ValueError('A deleted SQLite attachment is still referenced by history')
    if set(references) - set(attachments_by_id):
        raise ValueError('A history attachment reference has no matching SQLite row')
    upload_files = [path for path in uploads_path.rglob('*') if path.is_file()] if uploads_path.exists() else []
    key_decrypted = False
    if secrets:
        try:
            cipher.decrypt(secrets[0]['ciphertext'].encode('ascii'))
        except (InvalidToken, ValueError, UnicodeEncodeError) as error:
            raise ValueError('Recovery environment cannot decrypt the stored AI key') from error
        key_decrypted = True
    return {
        'counts': legacy_state_counts(state),
        'attachments': len(attachments),
        'attachmentFilesPresent': files_present,
        'uploadDirectoryFiles': len(upload_files),
        'environmentFilePresent': environment_path.is_file(),
        'passwordHashPresent': True,
        'encryptionKeyPresent': True,
        'encryptedAIKeyDecrypts': key_decrypted,
    }


def prune_backups(backup_root: Path, *, now: datetime | None = None,
                  retention_days: int = RETENTION_DAYS) -> list[str]:
    current = now or datetime.now(timezone.utc)
    cutoff = current.timestamp() - retention_days * 24 * 60 * 60
    removed: list[str] = []
    if not backup_root.exists():
        return removed
    for item in backup_root.iterdir():
        if (not item.name.startswith('tea-pwa-daily-') or item.is_symlink()
                or not item.is_dir() or item.stat().st_mtime >= cutoff):
            continue
        shutil.rmtree(item)
        removed.append(item.name)
    return removed


def create_daily_backup(database_path: Path, uploads_path: Path, environment_path: Path,
                        backup_root: Path, *, now: datetime | None = None,
                        retention_days: int = RETENTION_DAYS) -> dict[str, Any]:
    database_path = database_path.expanduser().resolve()
    uploads_path = uploads_path.expanduser().resolve()
    environment_path = environment_path.expanduser().resolve()
    backup_root = backup_root.expanduser().resolve()
    if not database_path.is_file() or not environment_path.is_file():
        raise ValueError('SQLite database and server environment file must both exist')
    if uploads_path.exists() and not uploads_path.is_dir():
        raise ValueError('Upload path is not a directory')
    _reject_symlinks(database_path)
    _reject_symlinks(environment_path)
    if uploads_path.exists():
        _reject_symlinks(uploads_path)
    _validate_backup_contents(database_path, uploads_path, environment_path,
                              json.loads((ROOT / 'server' / 'seed.json').read_text(encoding='utf-8')))

    current = now or datetime.now(timezone.utc)
    backup_root.mkdir(parents=True, exist_ok=True)
    _set_private(backup_root, directory=True)
    stamp = current.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    final_path = backup_root / f'tea-pwa-daily-{stamp}'
    if final_path.exists():
        final_path = backup_root / f'tea-pwa-daily-{stamp}-{uuid.uuid4().hex[:8]}'
    staging_path = backup_root / f'.tmp-{uuid.uuid4().hex}'
    staging_path.mkdir(mode=0o700)
    _set_private(staging_path, directory=True)
    try:
        snapshot_path = staging_path / 'tea.sqlite3'
        with closing(sqlite3.connect(database_path, timeout=10)) as source, closing(sqlite3.connect(snapshot_path)) as target:
            source.backup(target)
        _set_private(snapshot_path)
        copied_uploads = staging_path / 'tea.uploads'
        if uploads_path.exists():
            shutil.copytree(uploads_path, copied_uploads)
        else:
            copied_uploads.mkdir()
        _set_private(copied_uploads, directory=True)
        for item in copied_uploads.rglob('*'):
            _set_private(item, directory=item.is_dir())
        copied_environment = staging_path / 'server.env'
        shutil.copyfile(environment_path, copied_environment)
        _set_private(copied_environment)
        validation = _validate_backup_contents(
            snapshot_path, copied_uploads, copied_environment,
            json.loads((ROOT / 'server' / 'seed.json').read_text(encoding='utf-8')),
        )
        manifest = {
            'format': BACKUP_FORMAT,
            'createdAt': current.astimezone(timezone.utc).isoformat(),
            'retentionDays': retention_days,
            **validation,
        }
        manifest_path = staging_path / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        _set_private(manifest_path)
        os.replace(staging_path, final_path)
        _set_private(final_path, directory=True)
    except Exception:
        shutil.rmtree(staging_path, ignore_errors=True)
        raise
    removed = prune_backups(backup_root, now=current, retention_days=retention_days)
    return {'backupPath': str(final_path), 'manifest': manifest, 'prunedBackups': removed}


def _start_restored_service(data_dir: Path, environment_path: Path,
                            timeout_seconds: float = 20.0) -> None:
    values = dotenv_values(environment_path)
    child_env = os.environ.copy()
    for key, value in values.items():
        if value is not None:
            child_env[key] = value
    child_env['DATA_DIR'] = str(data_dir)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, '-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', str(port)],
        cwd=ROOT, env=child_env, stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + timeout_seconds
    try:
        url = f'http://127.0.0.1:{port}/api/healthz'
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('Restored service exited before becoming healthy')
            try:
                with urllib.request.urlopen(url, timeout=1) as response:
                    if response.status == 204:
                        return
            except (OSError, urllib.error.URLError):
                time.sleep(0.2)
        raise RuntimeError('Restored service did not become healthy before the timeout')
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def restore_drill(backup_path: Path) -> dict[str, Any]:
    backup_path = backup_path.expanduser().resolve()
    if not backup_path.is_dir() or backup_path.is_symlink():
        raise ValueError('Selected backup directory does not exist')
    _reject_symlinks(backup_path)
    source_database = backup_path / 'tea.sqlite3'
    source_uploads = backup_path / 'tea.uploads'
    source_environment = backup_path / 'server.env'
    manifest_path = backup_path / 'manifest.json'
    if not all(path.is_file() for path in (source_database, source_environment, manifest_path)) or not source_uploads.is_dir():
        raise ValueError('Backup is incomplete')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('format') != BACKUP_FORMAT:
        raise ValueError('Backup manifest format is unsupported')
    seed = json.loads((ROOT / 'server' / 'seed.json').read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory(prefix='tea-pwa-restore-') as temporary:
        temporary_root = Path(temporary)
        data_dir = temporary_root / 'data'
        data_dir.mkdir(mode=0o700)
        restored_database = data_dir / 'tea.sqlite3'
        shutil.copyfile(source_database, restored_database)
        restored_uploads = data_dir / 'tea.uploads'
        shutil.copytree(source_uploads, restored_uploads)
        restored_environment = temporary_root / 'server.env'
        shutil.copyfile(source_environment, restored_environment)
        _set_private(data_dir, directory=True)
        _set_private(restored_database)
        _set_private(restored_environment)
        validation = _validate_backup_contents(restored_database, restored_uploads, restored_environment, seed)
        if (validation['counts'] != manifest.get('counts')
                or validation['attachments'] != manifest.get('attachments')
                or validation['uploadDirectoryFiles'] != manifest.get('uploadDirectoryFiles')):
            raise ValueError('Restored counts do not match the backup manifest')
        _start_restored_service(data_dir, restored_environment)
        return {
            'ok': True,
            'sqliteIntegrity': 'ok',
            'countsMatchManifest': True,
            'uploadsVerified': validation['attachmentFilesPresent'] == validation['attachments'],
            'environmentVerified': validation['environmentFilePresent'],
            'encryptedAIKeyDecrypts': validation['encryptedAIKeyDecrypts'],
            'serviceHealthz': 204,
            'temporaryRestoreRemoved': True,
            'counts': validation['counts'],
            'attachments': validation['attachments'],
            'uploadDirectoryFiles': validation['uploadDirectoryFiles'],
        }


def _configured_paths(args: argparse.Namespace) -> tuple[Path, Path, Path, Path]:
    from server.app import ROOT as SERVER_ROOT, Settings

    config = Settings.from_environment()
    database_path = (args.database or config.database_path).expanduser().resolve()
    uploads_path = (args.uploads or database_path.with_suffix('.uploads')).expanduser().resolve()
    environment_path = (args.environment_file or SERVER_ROOT / '.env').expanduser().resolve()
    backup_root = (args.backup_dir or database_path.parent / 'backups' / 'daily').expanduser().resolve()
    return database_path, uploads_path, environment_path, backup_root


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Create or verify a private local PWA backup.')
    subparsers = parser.add_subparsers(dest='command', required=True)
    create_parser = subparsers.add_parser('create', help='Create a SQLite and uploads snapshot; retain 30 days.')
    create_parser.add_argument('--database', type=Path)
    create_parser.add_argument('--uploads', type=Path)
    create_parser.add_argument('--environment-file', type=Path)
    create_parser.add_argument('--backup-dir', type=Path)
    drill_parser = subparsers.add_parser('restore-drill', help='Restore a backup in a temporary directory and start the API briefly.')
    drill_parser.add_argument('backup', type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == 'restore-drill':
            _print_result(restore_drill(args.backup))
            return 0
        database_path, uploads_path, environment_path, backup_root = _configured_paths(args)
        _print_result(create_daily_backup(database_path, uploads_path, environment_path, backup_root))
        return 0
    except (OSError, RuntimeError, ValueError, sqlite3.Error) as error:
        _print_result({'ok': False, 'error': str(error) if isinstance(error, ValueError) else 'Backup or restore drill failed; see local service diagnostics.'})
        return 2


def _print_result(result: dict[str, Any]) -> None:
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == '__main__':
    sys.exit(main())
