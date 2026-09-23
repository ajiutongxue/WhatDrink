"""FastAPI entry point for the first PWA slice."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field
from cryptography.fernet import Fernet

from server.passwords import verify_password
from server.state import EDITABLE_SECTIONS, apply_mutation, default_state, inventory_operation, migrate_state, validate_state

ROOT = Path(__file__).resolve().parent
SEED = json.loads((ROOT / 'seed.json').read_text(encoding='utf-8'))
COOKIE_NAME = 'tea_session'
SESSION_SECONDS = 7 * 24 * 60 * 60


class LoginBody(BaseModel):
    password: Annotated[str, Field(min_length=1, max_length=1024)]



class SectionPatch(BaseModel):
    baseRevision: Annotated[int, Field(ge=0)]
    value: object


class MutationsBody(BaseModel):
    baseRevision: Annotated[int, Field(ge=0)]
    mutations: Annotated[list[dict[str, object]], Field(min_length=1, max_length=100)]


@dataclass(frozen=True)
class Settings:
    password_hash: str
    database_path: Path
    cookie_secure: bool
    app_environment: str
    allowed_origin: str | None = None
    encryption_key: str = ''

    def __post_init__(self) -> None:
        if self.encryption_key:
            try:
                Fernet(self.encryption_key.encode('ascii'))
            except (ValueError, UnicodeEncodeError) as error:
                raise RuntimeError('APP_ENCRYPTION_KEY must be a valid Fernet key; generate one with Fernet.generate_key()') from error

    @classmethod
    def from_environment(cls) -> 'Settings':
        load_dotenv(ROOT / '.env')
        environment = os.getenv('APP_ENV', 'development').strip().lower()
        secure_text = os.getenv('COOKIE_SECURE', 'true').strip().lower()
        cookie_secure = secure_text not in {'0', 'false', 'no'}
        if not cookie_secure and environment != 'development':
            raise RuntimeError('COOKIE_SECURE=false is only allowed with APP_ENV=development')
        data_dir = Path(os.getenv('DATA_DIR', str(ROOT / 'runtime'))).expanduser()
        if not data_dir.is_absolute():
            data_dir = ROOT / data_dir
        return cls(
            password_hash=os.getenv('APP_PASSWORD_HASH', '').strip(),
            database_path=data_dir / 'tea.sqlite3',
            cookie_secure=cookie_secure,
            app_environment=environment,
            allowed_origin=os.getenv('ALLOWED_ORIGIN') or None,
            encryption_key=os.getenv('APP_ENCRYPTION_KEY', '').strip(),
        )


def connect(database_path: Path) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    return connection


@contextmanager
def database(database_path: Path):
    connection = connect(database_path)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database(database_path: Path, seed_path: Path | None = None, encryption_key: str = '') -> None:
    source = seed_path or ROOT / 'seed.json'
    seed = json.loads(source.read_text(encoding='utf-8'))
    initial_state = default_state(seed)
    with database(database_path) as db:
        db.execute(
            'CREATE TABLE IF NOT EXISTS app_state ('
            'id INTEGER PRIMARY KEY CHECK (id = 1), '
            'revision INTEGER NOT NULL, payload TEXT NOT NULL)'
        )
        db.execute(
            'CREATE TABLE IF NOT EXISTS sessions ('
            'token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)'
        )
        db.execute('CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, ciphertext TEXT NOT NULL)')
        db.execute(
            'INSERT OR IGNORE INTO app_state (id, revision, payload) VALUES (1, 0, ?)',
            (json.dumps(initial_state, ensure_ascii=False, separators=(',', ':')),),
        )
        db.execute('DELETE FROM sessions WHERE expires_at <= ?', (int(time.time()),))
        row = db.execute('SELECT revision, payload FROM app_state WHERE id = 1').fetchone()
        old = json.loads(row['payload'])
        migrated = migrate_state(old, seed)
        legacy_key = (old.get('llm') or {}).get('apiKey')
        if legacy_key:
            if not encryption_key:
                raise RuntimeError('APP_ENCRYPTION_KEY is required to migrate a stored AI key')
            cipher = Fernet(encryption_key.encode('ascii'))
            db.execute('INSERT OR IGNORE INTO secrets(name, ciphertext) VALUES("llm_api_key", ?)',
                       (cipher.encrypt(legacy_key.encode('utf-8')).decode('ascii'),))
        if migrated != old:
            db.execute('UPDATE app_state SET payload = ? WHERE id = 1',
                       (json.dumps(migrated, ensure_ascii=False, separators=(',', ':')),))
        db.execute('PRAGMA user_version = 2')


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings.from_environment()
    failed_logins: dict[str, list[int]] = {}
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        initialize_database(config.database_path, encryption_key=config.encryption_key)
        yield

    application = FastAPI(title='今天喝点什么茶', docs_url=None, redoc_url=None, lifespan=lifespan)

    def check_origin(request: Request) -> None:
        origin = request.headers.get('origin')
        if not origin:
            return
        expected = config.allowed_origin
        if expected:
            valid = origin.rstrip('/') == expected.rstrip('/')
        else:
            parsed = urlparse(origin)
            valid = parsed.netloc == request.headers.get('host')
        if not valid:
            raise HTTPException(status_code=403, detail='Origin is not allowed')

    def authenticated_session(request: Request) -> str:
        token = request.cookies.get(COOKIE_NAME)
        if not token:
            raise HTTPException(status_code=401, detail='Login required')
        digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        with database(config.database_path) as db:
            row = db.execute(
                'SELECT expires_at FROM sessions WHERE token_hash = ?', (digest,)
            ).fetchone()
            if not row or row['expires_at'] <= int(time.time()):
                if row:
                    db.execute('DELETE FROM sessions WHERE token_hash = ?', (digest,))
                raise HTTPException(status_code=401, detail='Login required')
        return digest

    @application.get('/api/healthz', status_code=204)
    def healthz() -> Response:
        return Response(status_code=204, headers={'Cache-Control': 'no-store'})

    @application.post('/api/login')
    def login(body: LoginBody, request: Request, response: Response) -> dict[str, bool]:
        check_origin(request)
        if not config.password_hash:
            raise HTTPException(status_code=503, detail='APP_PASSWORD_HASH is not configured')
        now = int(time.time())
        client_key = request.client.host if request.client else 'unknown'
        attempts = [stamp for stamp in failed_logins.get(client_key, []) if stamp > now - 900]
        failed_logins[client_key] = attempts
        if len(attempts) >= 5:
            raise HTTPException(status_code=429, detail='Too many login attempts; try again later')
        if not verify_password(body.password, config.password_hash):
            attempts.append(now)
            failed_logins[client_key] = attempts
            raise HTTPException(status_code=401, detail='Incorrect password')
        failed_logins.pop(client_key, None)
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        expires_at = int(time.time()) + SESSION_SECONDS
        with database(config.database_path) as db:
            db.execute(
                'INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)',
                (digest, expires_at),
            )
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_SECONDS,
            expires=expires_at,
            httponly=True,
            secure=config.cookie_secure,
            samesite='lax',
            path='/',
        )
        return {'authenticated': True}

    @application.post('/api/logout')
    def logout(request: Request, response: Response, _: str = Depends(authenticated_session)) -> dict[str, bool]:
        check_origin(request)
        token = request.cookies.get(COOKIE_NAME, '')
        digest = hashlib.sha256(token.encode('utf-8')).hexdigest()
        with database(config.database_path) as db:
            db.execute('DELETE FROM sessions WHERE token_hash = ?', (digest,))
        response.delete_cookie(
            COOKIE_NAME,
            httponly=True,
            secure=config.cookie_secure,
            samesite='lax',
            path='/',
        )
        return {'authenticated': False}

    @application.get('/api/session')
    def session(request: Request, response: Response) -> dict[str, bool]:
        response.headers['Cache-Control'] = 'no-store'
        try:
            authenticated_session(request)
            return {'authenticated': True}
        except HTTPException as error:
            if error.status_code == 401:
                return {'authenticated': False}
            raise

    @application.get('/api/state')
    def read_state(response: Response, _: str = Depends(authenticated_session)) -> dict[str, object]:
        response.headers['Cache-Control'] = 'no-store'
        with database(config.database_path) as db:
            row = db.execute('SELECT revision, payload FROM app_state WHERE id = 1').fetchone()
        if not row:
            raise HTTPException(status_code=500, detail='Application state is missing')
        state = json.loads(row['payload'])
        seed_data = SEED
        if state.get('knowledgeBase') is None:
            state['knowledgeBase'] = catalog_to_knowledge_base(seed_data['knowledgeCatalog'])
        with database(config.database_path) as db:
            secret = db.execute('SELECT ciphertext FROM secrets WHERE name = "llm_api_key"').fetchone()
        state['llm']['apiKeyConfigured'] = bool(secret)
        state['llm'].pop('apiKey', None)
        return {'revision': row['revision'], 'state': state}

    @application.patch('/api/state/{section}')
    def patch_section(section: str, body: SectionPatch, request: Request,
                      _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request)
        if section not in EDITABLE_SECTIONS:
            raise HTTPException(status_code=404, detail='Unknown state section')
        with database(config.database_path) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision, payload FROM app_state WHERE id = 1').fetchone()
            if row['revision'] != body.baseRevision:
                raise HTTPException(status_code=409, detail='State revision changed')
            state = json.loads(row['payload'])
            value = body.value
            if section == 'llm':
                if not isinstance(value, dict): raise HTTPException(status_code=422, detail='llm must be an object')
                value = dict(value)
                supplied_key = value.pop('apiKey', None)
                if supplied_key is not None:
                    if not isinstance(supplied_key, str) or len(supplied_key) > 4096:
                        raise HTTPException(status_code=422, detail='Invalid AI key')
                    if supplied_key:
                        if not config.encryption_key: raise HTTPException(status_code=503, detail='APP_ENCRYPTION_KEY is not configured')
                        encrypted = Fernet(config.encryption_key.encode('ascii')).encrypt(supplied_key.encode('utf-8')).decode('ascii')
                        db.execute('INSERT INTO secrets(name, ciphertext) VALUES("llm_api_key", ?) ON CONFLICT(name) DO UPDATE SET ciphertext=excluded.ciphertext', (encrypted,))
                    else:
                        db.execute('DELETE FROM secrets WHERE name = "llm_api_key"')
                if 'apiKeyConfigured' in value: raise HTTPException(status_code=422, detail='apiKeyConfigured is read-only')
            if section == 'knowledgeBase':
                if not isinstance(value, dict) or not isinstance(value.get('profilesByTeaId'), dict) or not value['profilesByTeaId']:
                    raise HTTPException(status_code=422, detail='knowledgeBase requires profilesByTeaId')
                state['knowledgeBaseBackup'] = state.get('knowledgeBase') or catalog_to_knowledge_base(SEED['knowledgeCatalog'])
            state[section] = value
            try:
                validate_state(state, SEED)
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            revision = row['revision'] + 1
            db.execute('UPDATE app_state SET revision=?, payload=? WHERE id=1',
                       (revision, json.dumps(state, ensure_ascii=False, separators=(',', ':'))))
        return {'revision': revision, 'saved': section}

    @application.post('/api/mutations')
    def write_mutations(body: MutationsBody, request: Request,
                        _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request)
        with database(config.database_path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS processed_mutations (mutation_id TEXT PRIMARY KEY)')
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
            try:
                mutation_ids = []
                for mutation in body.mutations:
                    mutation_id = mutation.get('mutationId')
                    if not isinstance(mutation_id, str) or not mutation_id or len(mutation_id) > 200:
                        raise ValueError('mutationId is required')
                    mutation_ids.append(mutation_id)
                known = set()
                for mutation_id in set(mutation_ids):
                    exists = db.execute('SELECT 1 FROM processed_mutations WHERE mutation_id=?', (mutation_id,)).fetchone()
                    if exists: known.add(mutation_id)
                if row['revision'] != body.baseRevision:
                    if all(mutation_id in known for mutation_id in mutation_ids):
                        return {'revision': row['revision'], 'results': [
                            {'mutationId': mutation_id, 'duplicate': True} for mutation_id in mutation_ids]}
                    raise HTTPException(status_code=409, detail='State revision changed')
                state = json.loads(row['payload'])
                applied = []
                for mutation in body.mutations:
                    mutation_id = mutation['mutationId']
                    exists = db.execute('SELECT 1 FROM processed_mutations WHERE mutation_id=?', (mutation_id,)).fetchone()
                    if exists:
                        applied.append({'mutationId': mutation_id, 'duplicate': True}); continue
                    apply_mutation(state, mutation)
                    db.execute('INSERT INTO processed_mutations(mutation_id) VALUES(?)', (mutation_id,))
                    applied.append({'mutationId': mutation_id, 'duplicate': False})
                validate_state(state, SEED)
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            revision = row['revision'] + 1
            db.execute('UPDATE app_state SET revision=?, payload=? WHERE id=1',
                       (revision, json.dumps(state, ensure_ascii=False, separators=(',', ':'))))
        return {'revision': revision, 'results': applied}

    return application


def catalog_to_knowledge_base(catalog: dict[str, object]) -> dict[str, object]:
    teas = catalog.get('teas', [])
    return {'schemaVersion': catalog.get('schemaVersion'), 'catalogVersion': catalog.get('catalogVersion'),
            'sourceGeneratedAt': catalog.get('generatedAt'), 'importedAt': 0,
            'profilesByTeaId': {str(profile['teaId']): profile for profile in teas},
            'withheldTeaIds': catalog.get('withheldTeaIds', []),
            'validationSummary': {'profileCount': len(teas), 'expectedTeaCount': catalog.get('expectedTeaCount')}}

app = create_app()
