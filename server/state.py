"""Versioned single-user state helpers and inventory lifecycle operations."""
from __future__ import annotations

import copy
import json
import math
import time
import uuid
from pathlib import Path
from typing import Any

STATE_VERSION = 2
CONTRACT = json.loads((Path(__file__).resolve().parent / 'seed.json').read_text(encoding='utf-8'))['knowledgeContract']
EDITABLE_SECTIONS = {
    'profile', 'settings', 'teaLibrary', 'inventory',
    'knowledgeOverrides', 'knowledgeBase', 'llm',
}


def validate_knowledge_field(path: str, field: Any) -> None:
    parts = path.split('.')
    definition = CONTRACT['sections'].get(parts[0], {}).get(parts[1]) if len(parts) == 2 else None
    if definition is None or not isinstance(field, dict):
        raise ValueError(f'{path} is not a declared knowledge field')
    allowed = {'value', 'status', 'sourceType', 'confidence', 'updatedAt', 'sourceRefs', 'evidence'}
    if set(field) - allowed:
        raise ValueError(f'{path} contains unknown fields')
    status, source = field.get('status'), field.get('sourceType')
    if status not in CONTRACT['knowledgeStatuses'] or source not in CONTRACT['sourceTypes']:
        raise ValueError(f'{path} has invalid status or sourceType')
    confidence, updated = field.get('confidence'), field.get('updatedAt')
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1:
        raise ValueError(f'{path}.confidence must be from 0 to 1')
    if not isinstance(updated, (int, float)) or isinstance(updated, bool) or updated <= 0:
        raise ValueError(f'{path}.updatedAt must be positive')
    if 'sourceRefs' in field and (not isinstance(field['sourceRefs'], list) or any(not isinstance(x, str) or not x.strip() for x in field['sourceRefs'])):
        raise ValueError(f'{path}.sourceRefs must contain non-empty strings')
    if 'evidence' in field and not isinstance(field['evidence'], str):
        raise ValueError(f'{path}.evidence must be a string')
    value = field.get('value')
    if value is None:
        if definition.get('requiredValue') or status not in ('unknown', 'conflicted'):
            raise ValueError(f'{path}.value cannot be null for this status')
        if status == 'unknown' and (source != 'unknown' or confidence != 0):
            raise ValueError(f'{path} unknown values require unknown source and zero confidence')
        return
    if status == 'unknown':
        raise ValueError(f'{path} unknown status requires null value')
    valid_status_sources = {
        'confirmed': {'user', 'package', 'purchase'}, 'personal': {'user'},
        'inferred': {'llm'}, 'inherited': {'category_default'},
        'researched': {'package', 'purchase', 'official', 'retailer', 'community'},
    }
    if status in valid_status_sources and source not in valid_status_sources[status]:
        raise ValueError(f'{path} sourceType is invalid for status {status}')
    if status == 'researched' and (not field.get('sourceRefs') or not isinstance(field.get('evidence'), str) or not field['evidence'].strip()):
        raise ValueError(f'{path} researched value requires sourceRefs and evidence')
    if status in ('inferred', 'inherited') and (not isinstance(field.get('evidence'), str) or not field['evidence'].strip()):
        raise ValueError(f'{path} {status} value requires evidence')
    kind = definition['type']
    valid = True
    if kind == 'string': valid = isinstance(value, str) and bool(value.strip())
    elif kind == 'integer': valid = isinstance(value, int) and not isinstance(value, bool)
    elif kind in ('number', 'scale_0_5'): valid = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif kind == 'string_array': valid = isinstance(value, list) and all(isinstance(x, str) and x.strip() for x in value)
    elif kind == 'enum': valid = value in definition['values']
    elif kind == 'number_range': valid = isinstance(value, dict) and isinstance(value.get('min'), (int, float)) and isinstance(value.get('max'), (int, float)) and value['min'] <= value['max']
    if not valid:
        raise ValueError(f'{path}.value does not match the knowledge contract')
    if kind == 'scale_0_5' and not 0 <= value <= 5:
        raise ValueError(f'{path}.value must be between 0 and 5')
    if kind in ('integer', 'number', 'scale_0_5', 'number_range'):
        values = (value,) if kind != 'number_range' else (value['min'], value['max'])
        if any(isinstance(x, bool) or not math.isfinite(x) for x in values):
            raise ValueError(f'{path}.value must be finite')
        for number in values:
            if 'min' in definition and number < definition['min'] or 'max' in definition and number > definition['max']:
                raise ValueError(f'{path}.value is outside the knowledge contract range')


def _validate_profile(profile: Any, tea_id: int, path: str) -> None:
    if not isinstance(profile, dict) or not isinstance(profile.get('teaId'), int) or isinstance(profile.get('teaId'), bool) or profile['teaId'] != tea_id:
        raise ValueError(f'{path} is invalid')
    expected_top = {'teaId', 'profileVersion', 'lifecycle', 'research', *CONTRACT['sections']}
    if set(profile) != expected_top:
        raise ValueError(f'{path} has missing or unknown sections')
    if not isinstance(profile.get('profileVersion'), int) or isinstance(profile.get('profileVersion'), bool) or profile['profileVersion'] < 1:
        raise ValueError(f'{path}.profileVersion is invalid')
    if profile.get('lifecycle') != 'complete':
        raise ValueError(f'{path} is not complete')
    research = profile.get('research')
    if not isinstance(research, dict) or not isinstance(research.get('completeness'), (int, float)) or isinstance(research.get('completeness'), bool) or not math.isfinite(research['completeness']) or not 0 <= research['completeness'] <= 1 or not isinstance(research.get('conflicts'), list) or any(not isinstance(x, str) for x in research['conflicts']) or not isinstance(research.get('notes'), list) or any(not isinstance(x, str) for x in research['notes']):
        raise ValueError(f'{path}.research is invalid')
    known = 0
    total = 0
    for section, definitions in CONTRACT['sections'].items():
        fields = profile.get(section)
        if not isinstance(fields, dict) or set(fields) != set(definitions):
            raise ValueError(f'{path}.{section} is incomplete')
        for name in definitions:
            validate_knowledge_field(f'{section}.{name}', fields[name])
            total += 1
            if fields[name].get('value') is not None:
                known += 1
    if round(known / total, 4) != research['completeness']:
        raise ValueError(f'{path}.research.completeness does not match its fields')


def default_state(seed: dict[str, Any]) -> dict[str, Any]:
    return {
        'schemaVersion': STATE_VERSION,
        'teaLibrary': copy.deepcopy(seed['teas']),
        'history': [], 'temporaryAvoids': {},
        'profile': {'gender': '', 'age': '', 'city': '', 'constitution': None, 'quizAnswers': {}},
        'profileUpdatedAt': 0,
        'settings': {'avoidDays': 5}, 'settingsUpdatedAt': 0,
        'teaLibraryUpdatedAt': 0,
        'inventory': [], 'knowledgeOverrides': {}, 'knowledgeBase': None,
        'knowledgeBaseBackup': None,
        'llm': {'enabled': False, 'endpoint': '', 'recModel': 'deepseek-v4-pro',
                'parserModel': 'deepseek-v4-pro', 'parserEnabled': False,
                'noteAnalysisEnabled': True, 'twoStageRecommendationEnabled': False},
    }


def migrate_state(value: Any, seed: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError('state must be an object')
    version = value.get('schemaVersion', 1)
    if not isinstance(version, int) or isinstance(version, bool) or version > STATE_VERSION or version < 1:
        raise ValueError('unsupported state schemaVersion')
    state = default_state(seed)
    # v1 was the first-slice payload. Preserve known user data and fill newly
    # introduced collections from defaults. A legacy inline API key is removed.
    allowed_keys = set(state) | {'schemaVersion'}
    state.update({key: copy.deepcopy(item) for key, item in value.items() if key in allowed_keys})
    state['schemaVersion'] = STATE_VERSION
    llm_allowed = set(default_state(seed)['llm']) | {'apiKey'}
    legacy_llm = value.get('llm') if isinstance(value.get('llm'), dict) else {}
    state['llm'] = {**default_state(seed)['llm'], **{key: item for key, item in legacy_llm.items() if key in llm_allowed}}
    state['llm'].pop('apiKey', None)
    state.setdefault('knowledgeBaseBackup', None)
    validate_state(state, seed)
    return state


def validate_state(value: Any, seed: dict[str, Any]) -> None:
    if not isinstance(value, dict):
        raise ValueError('state must be an object')
    for key, kind in [('teaLibrary', list), ('history', list), ('temporaryAvoids', dict),
                      ('profile', dict), ('settings', dict), ('llm', dict),
                      ('knowledgeOverrides', dict), ('inventory', list)]:
        if not isinstance(value.get(key), kind):
            raise ValueError(f'{key} must be {kind.__name__}')
    allowed_top = set(default_state(seed))
    if set(value) - allowed_top:
        raise ValueError('state contains unknown top-level fields')
    if set(value['profile']) - {'gender', 'age', 'city', 'constitution', 'quizAnswers'}:
        raise ValueError('profile contains unknown fields')
    if set(value['settings']) - {'avoidDays'}:
        raise ValueError('settings contains unknown fields')
    if set(value['llm']) - {'enabled', 'endpoint', 'recModel', 'parserModel', 'parserEnabled',
                            'noteAnalysisEnabled', 'twoStageRecommendationEnabled'}:
        raise ValueError('llm contains unknown fields')
    if set(value['llm']) and any(not isinstance(value['llm'][key], bool) for key in
            ('enabled', 'parserEnabled', 'noteAnalysisEnabled', 'twoStageRecommendationEnabled') if key in value['llm']):
        raise ValueError('llm switches must be booleans')
    for key in ('endpoint', 'recModel', 'parserModel'):
        if key in value['llm'] and not isinstance(value['llm'][key], str):
            raise ValueError(f'llm.{key} must be a string')
    for key in ('age', 'city'):
        if key in value['profile'] and not isinstance(value['profile'][key], str):
            raise ValueError(f'profile.{key} must be a string')
    if 'quizAnswers' in value['profile'] and not isinstance(value['profile']['quizAnswers'], dict):
        raise ValueError('profile.quizAnswers must be an object')
    if not value['teaLibrary']:
        raise ValueError('teaLibrary cannot be empty')
    ids = [tea.get('id') for tea in value['teaLibrary'] if isinstance(tea, dict)]
    if len(ids) != len(value['teaLibrary']) or any(not isinstance(i, int) or isinstance(i, bool) for i in ids):
        raise ValueError('teaLibrary requires unique integer ids')
    if len(set(ids)) != len(ids):
        raise ValueError('teaLibrary requires unique integer ids')
    for tea in value['teaLibrary']:
        if not isinstance(tea.get('name'), str) or not tea['name'].strip() or not isinstance(tea.get('cat'), str):
            raise ValueError('teaLibrary entries require a name and category')
        if not isinstance(tea.get('seasons', []), list) or not isinstance(tea.get('avoidSeasons', []), list):
            raise ValueError('teaLibrary seasons must be arrays')
    avoid_days = value['settings'].get('avoidDays', 5)
    if not isinstance(avoid_days, int) or isinstance(avoid_days, bool) or not 1 <= avoid_days <= 30:
        raise ValueError('settings.avoidDays must be an integer from 1 to 30')
    if value['profile'].get('gender', '') not in ('', 'male', 'female'):
        raise ValueError('profile.gender is invalid')
    if value['profile'].get('constitution') not in (None, '偏寒', '平和', '偏热'):
        raise ValueError('profile.constitution is invalid')
    for key in ('profileUpdatedAt', 'settingsUpdatedAt', 'teaLibraryUpdatedAt'):
        if not isinstance(value.get(key, 0), int) or isinstance(value.get(key, 0), bool) or value.get(key, 0) < 0:
            raise ValueError(f'{key} must be a non-negative integer')
    for item in value['history']:
        if not isinstance(item, dict) or not isinstance(item.get('date'), str) or not item['date'] or not isinstance(item.get('teaId'), int) or isinstance(item.get('teaId'), bool):
            raise ValueError('history entries require date and integer teaId')
    seed_ids = {str(tea['id']) for tea in seed['teas']}
    knowledge = value.get('knowledgeBase')
    if knowledge is not None:
        profiles = knowledge.get('profilesByTeaId') if isinstance(knowledge, dict) else None
        withheld = knowledge.get('withheldTeaIds') if isinstance(knowledge, dict) else None
        if (not isinstance(profiles, dict) or not isinstance(withheld, list) or
                any(not isinstance(tea_id, int) or isinstance(tea_id, bool) for tea_id in withheld) or
                len(set(withheld)) != len(withheld)):
            raise ValueError('knowledgeBase profiles and withheldTeaIds are invalid')
        withheld_ids = {str(tea_id) for tea_id in withheld}
        if set(profiles) & withheld_ids or set(profiles) | withheld_ids != seed_ids:
            raise ValueError('knowledgeBase must cover each seeded tea exactly once')
        if (knowledge.get('schemaVersion') != CONTRACT['schemaVersion'] or
                not isinstance(knowledge.get('catalogVersion'), str) or not knowledge['catalogVersion'].strip()):
            raise ValueError('knowledgeBase schemaVersion or catalogVersion is invalid')
        summary = knowledge.get('validationSummary')
        if (not isinstance(summary, dict) or summary.get('profileCount') != len(profiles) or
                summary.get('expectedTeaCount') != len(seed_ids)):
            raise ValueError('knowledgeBase validationSummary is inconsistent')
        for tea_id, profile in profiles.items():
            _validate_profile(profile, int(tea_id), f'knowledgeBase profile {tea_id}')
    required_inventory = ('id', 'teaId', 'packageType', 'status', 'quantity', 'updatedAt')
    for item in value['inventory']:
        if not isinstance(item, dict) or any(key not in item for key in required_inventory):
            raise ValueError('inventory entries require id, teaId, packageType, status, quantity, and updatedAt')
        if not isinstance(item['id'], str) or not item['id'] or not isinstance(item['teaId'], int) or isinstance(item['teaId'], bool):
            raise ValueError('inventory id and teaId are invalid')
        if item['packageType'] not in ('sample', 'retail', 'split', 'gift', 'custom', 'unknown'):
            raise ValueError('inventory packageType is invalid')
        if item['status'] not in ('sealed', 'opened', 'finished', 'unknown'):
            raise ValueError('inventory status is invalid')
        allowed_inventory = {'id', 'teaId', 'packageType', 'packageLabel', 'sku', 'purchaseUrl', 'status',
                             'quantity', 'netWeightPerUnit', 'remainingWeight', 'remainingSessions', 'openedAt',
                             'note', 'updatedAt', 'deletedAt'}
        if set(item) - allowed_inventory:
            raise ValueError('inventory entry contains unknown fields')
        if not isinstance(item['quantity'], int) or isinstance(item['quantity'], bool) or item['quantity'] < 1:
            raise ValueError('inventory quantity must be positive')
        if item['status'] in ('opened', 'finished') and item['quantity'] != 1:
            raise ValueError('opened or finished inventory quantity must be one')
        if item['status'] == 'sealed' and 'openedAt' in item:
            raise ValueError('sealed inventory cannot have openedAt')
        if item.get('purchaseUrl') is not None and not str(item['purchaseUrl']).startswith(('https://', 'http://')):
            raise ValueError('inventory purchaseUrl must use http or https')
        for key in ('packageLabel', 'sku', 'note'):
            if key in item and not isinstance(item[key], str):
                raise ValueError(f'inventory {key} must be a string')
        for key in ('netWeightPerUnit', 'remainingWeight', 'openedAt', 'updatedAt', 'deletedAt'):
            if key in item and (not isinstance(item[key], (int, float)) or isinstance(item[key], bool) or not math.isfinite(item[key])):
                raise ValueError(f'inventory {key} must be a finite number')
        for key in ('netWeightPerUnit', 'remainingWeight', 'openedAt', 'deletedAt'):
            if key in item and item[key] < 0:
                raise ValueError(f'inventory {key} must be non-negative')
        if item.get('updatedAt', 0) < 1 or item.get('deletedAt', 1) < 1:
            raise ValueError('inventory updatedAt and deletedAt must be positive')
        if item.get('remainingSessions') is not None and (not isinstance(item['remainingSessions'], int) or isinstance(item['remainingSessions'], bool) or item['remainingSessions'] < 0):
            raise ValueError('inventory remainingSessions must be a non-negative integer')
        if item.get('netWeightPerUnit') is not None and item.get('remainingWeight') is not None and item['remainingWeight'] > item['netWeightPerUnit']:
            raise ValueError('inventory remainingWeight cannot exceed netWeightPerUnit')
        if item['status'] == 'finished' and item.get('remainingSessions', 0) != 0:
            raise ValueError('finished inventory must have zero remaining sessions')
        if item['status'] == 'finished' and item.get('remainingWeight', 0) != 0:
            raise ValueError('finished inventory must have zero remaining weight')
    library_ids = {tea['id'] for tea in value['teaLibrary']}
    for key, item in value['knowledgeOverrides'].items():
        if not isinstance(item, dict) or not isinstance(item.get('teaId'), int) or isinstance(item.get('teaId'), bool) or str(item['teaId']) != str(key):
            raise ValueError('knowledgeOverrides entries require a matching integer teaId')
        if item['teaId'] not in library_ids:
            raise ValueError('knowledgeOverrides teaId does not exist in teaLibrary')
        if not isinstance(item.get('patch', {}), dict) or not isinstance(item.get('lockedPaths', []), list) or not isinstance(item.get('tombstones', {}), dict):
            raise ValueError('knowledgeOverrides patch, lockedPaths, or tombstones has invalid structure')
        patch = item.get('patch', {})
        for path, field in patch.items():
            validate_knowledge_field(path, field)
        for path in item.get('lockedPaths', []):
            if not isinstance(path, str) or path not in patch:
                raise ValueError('knowledgeOverrides lockedPaths must reference patched fields')
        for path, timestamp in item.get('tombstones', {}).items():
            if not isinstance(path, str) or len(path.split('.')) != 2 or path.split('.')[0] not in CONTRACT['sections'] or path.split('.')[1] not in CONTRACT['sections'][path.split('.')[0]]:
                raise ValueError('knowledgeOverrides tombstone path is not declared')
            if not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp <= 0:
                raise ValueError('knowledgeOverrides tombstone timestamp must be positive')
    if len(json.dumps(value, ensure_ascii=False)) > 8_000_000:
        raise ValueError('state is too large')


def apply_mutation(state: dict[str, Any], mutation: dict[str, Any]) -> None:
    op, entity_id, value = mutation.get('type'), mutation.get('entityId'), mutation.get('value')
    if not isinstance(entity_id, str) or not entity_id or len(entity_id) > 200:
        raise ValueError('entityId is required')
    if op == 'upsert_history':
        if not isinstance(value, dict) or value.get('id') != entity_id or not isinstance(value.get('date'), str) or not isinstance(value.get('teaId'), int):
            raise ValueError('history mutation requires a matching id, date, and integer teaId')
        state['history'] = [item for item in state['history'] if item.get('id') != entity_id]
        state['history'].append(copy.deepcopy(value))
    elif op == 'set_avoid':
        if not isinstance(value, dict) or not isinstance(value.get('active'), bool) or not isinstance(value.get('updatedAt'), int) or isinstance(value.get('updatedAt'), bool) or value['updatedAt'] < 0:
            raise ValueError('avoid mutation requires active and updatedAt')
        state['temporaryAvoids'][entity_id] = copy.deepcopy(value)
    else:
        raise ValueError('unsupported mutation type')


def inventory_operation(records: list[dict[str, Any]], operation: str, item_id: str,
                        now: int | None = None) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Pure counterpart of utils/data.js sealed/opened/finished/tombstone flow."""
    result = copy.deepcopy(records)
    stamp = now or int(time.time() * 1000)
    index = next((i for i, row in enumerate(result) if row.get('id') == item_id and not row.get('deletedAt')), -1)
    if index < 0:
        raise ValueError('Inventory item not found')
    item = result[index]
    if operation == 'open':
        if item.get('status') != 'sealed': raise ValueError('Only sealed inventory can be opened')
        split = item.get('quantity', 1) > 1
        opened = copy.deepcopy(item); opened.update(status='opened', quantity=1, openedAt=stamp, updatedAt=stamp)
        if 'remainingWeight' not in opened and isinstance(opened.get('netWeightPerUnit'), (int, float)):
            opened['remainingWeight'] = opened['netWeightPerUnit']
        if split:
            item['quantity'] -= 1; item['updatedAt'] = stamp
            opened['id'] = f'inv_{uuid.uuid4().hex}'
            result.append(opened)
        else:
            result[index] = opened
        return result, copy.deepcopy(opened)
    if operation == 'consume':
        if item.get('status') != 'opened' or not isinstance(item.get('remainingSessions'), int) or item['remainingSessions'] <= 0:
            raise ValueError('opened inventory with remaining sessions is required')
        item['remainingSessions'] -= 1; item['updatedAt'] = stamp
        if item['remainingSessions'] == 0:
            item['status'] = 'finished'
            if 'remainingWeight' in item: item['remainingWeight'] = 0
    elif operation == 'finish':
        if item.get('status') != 'opened': raise ValueError('Only opened inventory can be finished')
        item.update(status='finished', quantity=1, updatedAt=stamp)
        if 'remainingWeight' in item: item['remainingWeight'] = 0
        if 'remainingSessions' in item: item['remainingSessions'] = 0
    elif operation == 'delete':
        item['deletedAt'] = stamp; item['updatedAt'] = stamp
    else:
        raise ValueError('unsupported inventory operation')
    return result, copy.deepcopy(item)
