"""Small, explicit helpers for PWA JSON replacement and knowledge packages."""

from __future__ import annotations

import copy
import json
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from server.state import default_state, migrate_state, validate_state


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
