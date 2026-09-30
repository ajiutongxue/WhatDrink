"""Small, explicit helpers for PWA JSON replacement and knowledge packages."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet

from server.state import default_state, migrate_state, validate_state


LEGACY_REQUIRED_FIELDS = {
    'profile', 'history', 'temporaryAvoids', 'settings', 'llm', 'teaLibrary',
    'knowledgeBase', 'knowledgeOverrides', 'inventory',
}
LEGACY_METADATA_FIELDS = {'profileUpdatedAt', 'settingsUpdatedAt', 'teaLibraryUpdatedAt'}
LEGACY_LLM_FIELDS = {
    'enabled', 'apiKey', 'endpoint', 'recModel', 'parserModel', 'parserEnabled',
    'noteAnalysisEnabled', 'twoStageRecommendationEnabled',
}


def parse_pwa_export(value: Any, seed: dict[str, Any]) -> dict[str, Any]:
    """Accept only this app's complete export; old mini-program imports are step 6."""
    if not isinstance(value, dict) or value.get('format') != 'tea-pwa-v1':
        raise ValueError('Only a tea-pwa-v1 export can be imported here')
    source = value.get('state')
    if not isinstance(source, dict) or not isinstance(source.get('teaLibrary'), list) or not isinstance(source.get('history'), list):
        raise ValueError('PWA export is missing its state')
    if source.get('schemaVersion') != default_state(seed)['schemaVersion']:
        raise ValueError('PWA export schema version is not supported')
    if set(source) != set(default_state(seed)):
        raise ValueError('PWA export is incomplete or contains unknown fields')
    candidate = copy.deepcopy(source)
    llm = candidate.get('llm')
    if not isinstance(llm, dict) or 'apiKey' in llm:
        raise ValueError('PWA export must not contain an API key')
    llm.pop('apiKeyConfigured', None)
    candidate = migrate_state(candidate, seed)
    validate_state(candidate, seed)
    return candidate


def parse_legacy_export(value: Any, seed: dict[str, Any]) -> tuple[dict[str, Any], str, dict[str, Any]]:
    """Validate and translate one raw tea_doctor_v1 export without touching SQLite."""
    if not isinstance(value, dict) or 'format' in value or 'state' in value:
        raise ValueError('Expected a raw tea_doctor_v1 object, not a PWA export')
    if value.get('schemaVersion') not in (None, 1):
        raise ValueError('Unsupported legacy export schema')
    allowed = LEGACY_REQUIRED_FIELDS | LEGACY_METADATA_FIELDS | {'schemaVersion'}
    missing = sorted(LEGACY_REQUIRED_FIELDS - set(value))
    unknown = sorted(set(value) - allowed)
    if missing:
        raise ValueError('Legacy export is missing required fields: ' + ', '.join(missing))
    if unknown:
        raise ValueError('Legacy export contains unsupported fields: ' + ', '.join(unknown))
    if not isinstance(value['llm'], dict) or set(value['llm']) - LEGACY_LLM_FIELDS:
        raise ValueError('Legacy llm section has an unsupported structure')
    source_key = value['llm'].get('apiKey', '')
    if not isinstance(source_key, str) or len(source_key) > 4096:
        raise ValueError('Legacy llm API key field is invalid')

    source_library = value['teaLibrary']
    source_history = value['history']
    if not isinstance(source_library, list) or not source_library:
        raise ValueError('Legacy teaLibrary must be a non-empty array')
    if not isinstance(source_history, list):
        raise ValueError('Legacy history must be an array')
    if not isinstance(value['profile'], dict) or not isinstance(value['settings'], dict):
        raise ValueError('Legacy profile or settings section has an invalid structure')
    if not isinstance(value['temporaryAvoids'], dict):
        raise ValueError('Legacy temporaryAvoids must be an object')
    if not isinstance(value['knowledgeOverrides'], dict):
        raise ValueError('Legacy knowledgeOverrides must be an object')
    if not isinstance(value['inventory'], list):
        raise ValueError('Legacy inventory must be an array')
    if value['knowledgeBase'] is not None and not isinstance(value['knowledgeBase'], dict):
        raise ValueError('Legacy knowledgeBase must be an object or null')

    candidate = default_state(seed)
    for section in ('profile', 'settings', 'teaLibrary', 'history', 'temporaryAvoids',
                    'knowledgeBase', 'knowledgeOverrides', 'inventory'):
        candidate[section] = copy.deepcopy(value[section])
    for metadata in LEGACY_METADATA_FIELDS:
        if metadata in value:
            candidate[metadata] = copy.deepcopy(value[metadata])
    candidate['llm'] = {key: copy.deepcopy(item) for key, item in value['llm'].items()
                        if key in LEGACY_LLM_FIELDS - {'apiKey'}}
    candidate['schemaVersion'] = 1
    candidate = migrate_state(candidate, seed)

    library_ids = {tea['id'] for tea in candidate['teaLibrary']}
    errors: list[str] = []
    warnings: list[str] = []
    ignored_images: list[dict[str, Any]] = []
    generated_history_ids: list[dict[str, Any]] = []
    history_ids: set[str] = set()
    for index, entry in enumerate(candidate['history']):
        if not isinstance(entry, dict):
            errors.append(f'history[{index}] must be an object')
            continue
        legacy_images = entry.pop('imageFileIDs', None)
        if legacy_images is not None:
            if not isinstance(legacy_images, list):
                errors.append(f'history[{index}].imageFileIDs must be an array')
            else:
                for image_index, image in enumerate(legacy_images):
                    file_id = image if isinstance(image, str) else image.get('fileID') if isinstance(image, dict) else None
                    ignored_images.append({
                        'historyId': entry.get('id') if isinstance(entry.get('id'), str) else None,
                        'index': image_index,
                        'fileID': file_id[:512] if isinstance(file_id, str) else None,
                        'fileIDTruncated': isinstance(file_id, str) and len(file_id) > 512,
                    })
        history_id = entry.get('id')
        if history_id is None or history_id == '':
            fingerprint = json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            history_id = 'legacy_' + hashlib.sha256(f'{index}:{fingerprint}'.encode('utf-8')).hexdigest()[:24]
            entry['id'] = history_id
            generated_history_ids.append({'index': index, 'id': history_id})
        if not isinstance(history_id, str) or len(history_id) > 200:
            errors.append(f'history[{index}].id is invalid')
        elif history_id in history_ids:
            errors.append(f'history[{index}].id is duplicated')
        else:
            history_ids.add(history_id)
        tea_id = entry.get('teaId')
        if not isinstance(tea_id, int) or isinstance(tea_id, bool):
            errors.append(f'history[{index}].teaId is invalid')
        elif tea_id == -1:
            has_custom_name = isinstance(entry.get('teaName'), str) and bool(entry['teaName'].strip())
            if entry.get('type') == 'custom' and not has_custom_name:
                errors.append(f'history[{index}] has an invalid custom-tea reference')
            elif entry.get('type') not in ('custom', 'skip'):
                errors.append(f'history[{index}] has an invalid custom-tea reference')
        elif tea_id not in library_ids:
            if isinstance(entry.get('teaName'), str) and entry['teaName'].strip():
                warnings.append(f'history[{index}] references teaId {tea_id} absent from the current library; its historical tea snapshot is preserved')
            else:
                errors.append(f'history[{index}] references an unavailable tea without a historical name')
        if entry.get('type') not in ('primary', 'alt', 'custom', 'skip'):
            errors.append(f'history[{index}].type is invalid')

    for tea_id, avoid in candidate['temporaryAvoids'].items():
        if not isinstance(tea_id, str) or not re.fullmatch(r'\d{1,10}', tea_id) or str(int(tea_id)) != tea_id:
            errors.append('temporaryAvoids contains an invalid tea ID')
            break
        if int(tea_id) not in library_ids:
            warnings.append(f'temporaryAvoids[{tea_id}] references a tea absent from the current library; state is preserved')
        if not isinstance(avoid, dict) or not isinstance(avoid.get('active'), bool):
            errors.append(f'temporaryAvoids[{tea_id}] has an invalid structure')
            continue
        for field in ('markedAt', 'expiresAt', 'updatedAt'):
            timestamp = avoid.get(field, 0)
            if not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp < 0:
                errors.append(f'temporaryAvoids[{tea_id}].{field} is invalid')
                break

    for index, item in enumerate(candidate['inventory']):
        if isinstance(item, dict) and item.get('teaId') not in library_ids:
            if item.get('deletedAt'):
                warnings.append(f'inventory[{index}] is a deleted item whose tea is absent from the current library; tombstone is preserved')
            else:
                errors.append(f'inventory[{index}] references a tea absent from the current library')

    if errors:
        raise ValueError('Legacy export validation failed: ' + '; '.join(errors[:20]))
    report = {
        'ok': True,
        'counts': legacy_state_counts(candidate),
        'warnings': warnings,
        'generatedHistoryIds': generated_history_ids,
        'ignoredImageFileIDs': ignored_images,
        'aiKeyPresent': bool(source_key),
        'samples': legacy_state_samples(candidate),
    }
    return candidate, source_key, report


def legacy_state_counts(state: dict[str, Any]) -> dict[str, int]:
    knowledge = state.get('knowledgeBase')
    profiles = knowledge.get('profilesByTeaId', {}) if isinstance(knowledge, dict) else {}
    return {
        'teaLibrary': len(state.get('teaLibrary', [])),
        'history': len(state.get('history', [])),
        'temporaryAvoids': len(state.get('temporaryAvoids', {})),
        'inventory': len(state.get('inventory', [])),
        'knowledgeOverrides': len(state.get('knowledgeOverrides', {})),
        'knowledgeBaseProfiles': len(profiles) if isinstance(profiles, dict) else 0,
    }


def legacy_state_samples(state: dict[str, Any]) -> dict[str, Any]:
    knowledge = state.get('knowledgeBase')
    profiles = knowledge.get('profilesByTeaId', {}) if isinstance(knowledge, dict) else {}
    return {
        'history': [{key: entry.get(key) for key in ('id', 'date', 'teaId', 'teaName', 'type')}
                    for entry in state.get('history', [])[:3]],
        'inventory': [{key: item.get(key) for key in ('id', 'teaId', 'packageType', 'status', 'quantity')}
                      for item in state.get('inventory', [])[:3]],
        'knowledgeBaseProfiles': [
            {'teaId': int(tea_id), 'profileVersion': profile.get('profileVersion'), 'lifecycle': profile.get('lifecycle')}
            for tea_id, profile in sorted(profiles.items())[:3] if isinstance(profile, dict)
        ],
        'knowledgeOverrides': [{'teaId': item.get('teaId'), 'fieldPaths': sorted(item.get('patch', {}))[:8]}
                               for item in list(state.get('knowledgeOverrides', {}).values())[:3]],
        'profileFields': sorted(state.get('profile', {}).keys()),
        'settings': {'avoidDays': state.get('settings', {}).get('avoidDays'),
                     'updatedAt': state.get('settingsUpdatedAt', 0)},
    }


class LegacyImportError(RuntimeError):
    def __init__(self, message: str, backup_path: Path | None = None):
        super().__init__(message)
        self.backup_path = backup_path


def import_legacy_database(database_path: Path, state: dict[str, Any], source_key: str,
                           source_digest: str, seed: dict[str, Any], encryption_key: str,
                           *, allow_repeat: bool = False) -> dict[str, Any]:
    """Replace the PWA state atomically, after a SQLite backup, exactly once by default."""
    if not database_path.is_file():
        raise LegacyImportError('Configured SQLite database does not exist; start the PWA once before importing')
    cipher: Fernet | None = None
    if source_key:
        if not encryption_key:
            raise LegacyImportError('APP_ENCRYPTION_KEY is required because this export contains an AI key')
        try:
            cipher = Fernet(encryption_key.encode('ascii'))
        except (ValueError, UnicodeEncodeError) as error:
            raise LegacyImportError('APP_ENCRYPTION_KEY is invalid') from error
    validate_state(state, seed)
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    backup_path: Path | None = None
    try:
        connection.execute('BEGIN IMMEDIATE')
        tables = {row['name'] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'app_state' not in tables or 'secrets' not in tables:
            raise LegacyImportError('PWA database is not initialized')
        current_row = connection.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
        if not current_row:
            raise LegacyImportError('PWA database state is missing')
        try:
            current_state = json.loads(current_row['payload'])
        except (TypeError, json.JSONDecodeError) as error:
            raise LegacyImportError('PWA database state is invalid') from error
        current_counts = legacy_state_counts(current_state)
        marker_exists = 'legacy_import_status' in tables
        marker = connection.execute('SELECT source_sha256, imported_at FROM legacy_import_status WHERE id=1').fetchone() if marker_exists else None
        if marker and not allow_repeat:
            raise LegacyImportError('A legacy import is already recorded; pass --allow-repeat to replace it explicitly')
        backup_path = snapshot_database(database_path)
        next_revision = int(current_row['revision']) + 1
        connection.execute('UPDATE app_state SET revision=?, payload=? WHERE id=1',
                           (next_revision, serialize_state(state)))
        if 'apiKey' in state.get('llm', {}):
            raise LegacyImportError('Internal import state unexpectedly contains a plaintext API key', backup_path)
        if cipher is not None:
            encrypted = cipher.encrypt(source_key.encode('utf-8')).decode('ascii')
            connection.execute('INSERT INTO secrets(name, ciphertext) VALUES("llm_api_key", ?) '
                               'ON CONFLICT(name) DO UPDATE SET ciphertext=excluded.ciphertext', (encrypted,))
        else:
            connection.execute('DELETE FROM secrets WHERE name="llm_api_key"')
        if 'processed_mutations' in tables:
            connection.execute('DELETE FROM processed_mutations')
        connection.execute('CREATE TABLE IF NOT EXISTS legacy_import_status '
                           '(id INTEGER PRIMARY KEY CHECK(id=1), source_sha256 TEXT NOT NULL, imported_at INTEGER NOT NULL)')
        connection.execute('INSERT INTO legacy_import_status(id, source_sha256, imported_at) VALUES(1, ?, ?) '
                           'ON CONFLICT(id) DO UPDATE SET source_sha256=excluded.source_sha256, imported_at=excluded.imported_at',
                           (source_digest, int(time.time())))
        connection.commit()
        return {
            'ok': True,
            'revision': next_revision,
            'backupPath': str(backup_path),
            'alreadyImported': bool(marker),
            'previousCounts': current_counts,
            'counts': legacy_state_counts(state),
            'samples': legacy_state_samples(state),
            'aiKeyImported': cipher is not None,
        }
    except LegacyImportError:
        connection.rollback()
        raise
    except (sqlite3.Error, OSError, ValueError) as error:
        connection.rollback()
        raise LegacyImportError('Legacy import failed; the database transaction was rolled back', backup_path) from error
    finally:
        connection.close()


def prepare_knowledge_install(catalog: Any, current: dict[str, Any], seed: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(catalog, dict) or catalog.get('purpose') != 'import':
        raise ValueError('Knowledge package must have import purpose')
    teas = catalog.get('teas')
    expected = {tea['id'] for tea in seed['teas']}
    if (not isinstance(teas, list) or len(teas) != len(expected)
            or any(not isinstance(profile, dict) or profile.get('lifecycle') != 'complete' for profile in teas)):
        raise ValueError('Knowledge package must contain complete profiles for every built-in tea')
    ids = [profile.get('teaId') for profile in teas]
    if any(not isinstance(tea_id, int) or isinstance(tea_id, bool) for tea_id in ids):
        raise ValueError('Knowledge package tea IDs are invalid')
    if len(set(ids)) != len(ids) or set(ids) != expected:
        raise ValueError('Knowledge package tea IDs do not match the built-in catalog')
    if catalog.get('expectedTeaCount') != len(expected) or catalog.get('withheldTeaIds') not in ([], None):
        raise ValueError('Knowledge package counts are inconsistent')
    knowledge = {
        'schemaVersion': catalog.get('schemaVersion'),
        'catalogVersion': catalog.get('catalogVersion'),
        'sourceGeneratedAt': catalog.get('generatedAt'),
        'importedAt': int(time.time() * 1000),
        'profilesByTeaId': {str(profile['teaId']): profile for profile in teas},
        'withheldTeaIds': [],
        'validationSummary': {'profileCount': len(teas), 'expectedTeaCount': len(expected)},
    }
    candidate = copy.deepcopy(current)
    baseline = current.get('knowledgeBase')
    if baseline is None:
        bundled = seed['knowledgeCatalog']
        bundled_teas = bundled['teas']
        baseline = {
            'schemaVersion': bundled['schemaVersion'], 'catalogVersion': bundled['catalogVersion'],
            'sourceGeneratedAt': bundled.get('generatedAt'), 'importedAt': 0,
            'profilesByTeaId': {str(profile['teaId']): profile for profile in bundled_teas},
            'withheldTeaIds': bundled.get('withheldTeaIds', []),
            'validationSummary': {'profileCount': len(bundled_teas), 'expectedTeaCount': bundled['expectedTeaCount']},
        }
    candidate['knowledgeBaseBackup'] = copy.deepcopy(baseline)
    candidate['knowledgeBase'] = knowledge
    validate_state(candidate, seed)
    return candidate


def snapshot_database(database_path: Path) -> Path:
    """Create a recoverable SQLite snapshot before destructive import/reset."""
    backup_dir = database_path.parent / 'backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f'tea-before-change-{int(time.time())}-{uuid.uuid4().hex[:8]}.sqlite3'
    with closing(sqlite3.connect(database_path)) as source, closing(sqlite3.connect(backup_path)) as target:
        source.backup(target)
    return backup_path


def serialize_state(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
