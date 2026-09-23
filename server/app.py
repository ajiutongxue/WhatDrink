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

from server.passwords import verify_password

ROOT = Path(__file__).resolve().parent
COOKIE_NAME = 'tea_session'
SESSION_SECONDS = 7 * 24 * 60 * 60


class LoginBody(BaseModel):
    password: Annotated[str, Field(min_length=1, max_length=1024)]


@dataclass(frozen=True)
class Settings:
    password_hash: str
    database_path: Path
    cookie_secure: bool
    app_environment: str
    allowed_origin: str | None = None

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


def initialize_database(database_path: Path, seed_path: Path | None = None) -> None:
    source = seed_path or ROOT / 'seed.json'
    seed = json.loads(source.read_text(encoding='utf-8'))
    initial_state = {
        'teaLibrary': seed['teas'],
        'history': [],
        'temporaryAvoids': {},
        'profile': {
            'gender': '', 'age': '', 'city': '', 'constitution': None, 'quizAnswers': {},
        },
        'profileUpdatedAt': 0,
        'settings': {'avoidDays': 5},
        'settingsUpdatedAt': 0,
        'inventory': [],
        'knowledgeOverrides': {},
        'teaLibraryUpdatedAt': 0,
        'llm': {
            'enabled': False,
            'endpoint': '',
            'recModel': 'deepseek-v4-pro',
            'parserModel': 'deepseek-v4-pro',
            'parserEnabled': False,
            'noteAnalysisEnabled': True,
            'twoStageRecommendationEnabled': False,
        },
    }
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
        db.execute(
            'INSERT OR IGNORE INTO app_state (id, revision, payload) VALUES (1, 0, ?)',
            (json.dumps(initial_state, ensure_ascii=False, separators=(',', ':')),),
        )
        db.execute('DELETE FROM sessions WHERE expires_at <= ?', (int(time.time()),))
        db.execute('PRAGMA user_version = 1')


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings.from_environment()
    failed_logins: dict[str, list[int]] = {}
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        initialize_database(config.database_path)
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
        return {'revision': row['revision'], 'state': json.loads(row['payload'])}

    return application


app = create_app()
