"""Dry-run and explicit one-time import for raw tea_doctor_v1 exports."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

from server.data_management import LegacyImportError, import_legacy_database, parse_legacy_export


SERVER_ROOT = Path(__file__).resolve().parent
SEED = json.loads((SERVER_ROOT / 'seed.json').read_text(encoding='utf-8'))
MAX_EXPORT_BYTES = 32 * 1024 * 1024


def read_export(path: Path) -> tuple[bytes, object]:
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ValueError('Could not read the selected legacy export file') from error
    if len(raw) > MAX_EXPORT_BYTES:
        raise ValueError('Legacy export exceeds the 32 MiB safety limit')
    try:
        value = json.loads(raw.decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError('Legacy export is not valid UTF-8 JSON') from error
    return raw, value


def _print_result(result: dict[str, object]) -> None:
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Validate or explicitly import a raw tea_doctor_v1 JSON export.')
    parser.add_argument('--input', required=True, type=Path, help='Path to the original mini-program JSON export (read only).')
    parser.add_argument('--apply', action='store_true', help='Write the validated data into the configured PWA SQLite database.')
    parser.add_argument('--allow-repeat', action='store_true', help='Explicitly permit replacing a database that already records a legacy import.')
    parser.add_argument('--database', type=Path, help='Override the configured SQLite path; intended for isolated validation.')
    args = parser.parse_args(argv)
    mode = 'apply' if args.apply else 'dry-run'
    if args.allow_repeat and not args.apply:
        parser.error('--allow-repeat requires --apply')

    try:
        raw, source = read_export(args.input)
        state, source_key, plan = parse_legacy_export(source, SEED)
    except ValueError as error:
        _print_result({'ok': False, 'mode': mode, 'errors': [str(error)]})
        return 2

    if not args.apply:
        _print_result({'ok': True, 'mode': 'dry-run', **plan})
        return 0

    backup_path: Path | None = None
    try:
        from server.app import Settings

        config = Settings.from_environment()
        database_path = (args.database or config.database_path).expanduser().resolve()
        result = import_legacy_database(
            database_path, state, source_key, hashlib.sha256(raw).hexdigest(), SEED,
            config.encryption_key, allow_repeat=args.allow_repeat,
        )
        _print_result({'mode': 'apply', **plan, **result})
        return 0
    except LegacyImportError as error:
        backup_path = error.backup_path
        _print_result({
            'ok': False, 'mode': 'apply', 'errors': [str(error)],
            'backupPath': str(backup_path) if backup_path else None,
            'backupRetained': bool(backup_path and backup_path.is_file()),
        })
        return 2
    except (OSError, RuntimeError, ValueError) as error:
        _print_result({'ok': False, 'mode': 'apply', 'errors': ['Import configuration or file operation failed; no success was reported.']})
        return 2


if __name__ == '__main__':
    sys.exit(main())
