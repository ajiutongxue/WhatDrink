"""FastAPI entry point for the first PWA slice."""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import math
import os
import re
import secrets
import socket
import sqlite3
import time
import warnings
from io import BytesIO
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlparse, urlsplit, urlunsplit

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from cryptography.fernet import Fernet, InvalidToken

from server.passwords import verify_password
from server.data_management import parse_pwa_export, prepare_knowledge_install, serialize_state, snapshot_database
from server.state import EDITABLE_SECTIONS, apply_mutation, default_state, inventory_operation, migrate_state, validate_state

ROOT = Path(__file__).resolve().parent
SEED = json.loads((ROOT / 'seed.json').read_text(encoding='utf-8'))
COOKIE_NAME = 'tea_session'
SESSION_SECONDS = 7 * 24 * 60 * 60


class LoginBody(BaseModel):
    password: Annotated[str, Field(min_length=1, max_length=1024)]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra='forbid')

    role: Literal['system', 'user', 'assistant']
    content: Annotated[str, Field(min_length=1, max_length=16_000)]


class AIChatBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    purpose: Literal['parse', 'recommend', 'quote', 'note', 'coarse']
    messages: Annotated[list[ChatMessage], Field(min_length=1, max_length=24)]
    maxTokens: Annotated[int | None, Field(ge=1, le=4096)] = None

    @model_validator(mode='after')
    def validate_total_message_size(self) -> 'AIChatBody':
        if sum(len(message.content) for message in self.messages) > 30_000:
            raise ValueError('messages are too large')
        return self

class SectionPatch(BaseModel):
    baseRevision: Annotated[int, Field(ge=0)]
    value: object


class MutationsBody(BaseModel):
    baseRevision: Annotated[int, Field(ge=0)]
    mutations: Annotated[list[dict[str, object]], Field(min_length=1, max_length=100)]


class AttachmentCaptionBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    baseRevision: Annotated[int, Field(ge=0)]
    caption: Annotated[str, Field(max_length=40)]


class AttachmentRestoreBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    baseRevision: Annotated[int, Field(ge=0)]


class DataResetBody(BaseModel):
    model_config = ConfigDict(extra='forbid')

    baseRevision: Annotated[int, Field(ge=0)]


@dataclass(frozen=True)
class Settings:
    password_hash: str
    database_path: Path
    cookie_secure: bool
    app_environment: str
    allowed_origin: str | None = None
    encryption_key: str = ''
    amap_key: str = field(default='', repr=False)

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
            amap_key=os.getenv('AMAP_KEY', '').strip(),
        )


AI_BODY_LIMIT = 64 * 1024
AI_REQUEST_TIMEOUT_SECONDS = 30.0
AMAP_REQUEST_TIMEOUT_SECONDS = 8.0
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
MAX_ATTACHMENT_PIXELS = 40_000_000
MAX_ATTACHMENTS_PER_HISTORY = 6
MAX_ATTACHMENT_CAPTION_LENGTH = 40
ATTACHMENT_MIME_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}
ATTACHMENT_ID_PATTERN = re.compile(r'^att_[0-9a-f]{32}$')


def _sanitize_image(data: bytes) -> tuple[bytes, str]:
    """Decode and re-encode a still image, dropping EXIF, GPS, and other metadata."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                image_format = source.format
                if image_format not in {'JPEG', 'PNG', 'WEBP'}:
                    raise ValueError('unsupported_image_format')
                if getattr(source, 'is_animated', False) or getattr(source, 'n_frames', 1) > 1:
                    raise ValueError('animated_images_not_supported')
                width, height = source.size
                if width <= 0 or height <= 0 or width * height > MAX_ATTACHMENT_PIXELS:
                    raise ValueError('image_dimensions_exceed_limit')
                source.verify()

            with Image.open(BytesIO(data)) as source:
                source.load()
                normalized = ImageOps.exif_transpose(source)
                output = BytesIO()
                if image_format == 'JPEG':
                    normalized.convert('RGB').save(output, format='JPEG', quality=90, optimize=True)
                    content_type = 'image/jpeg'
                elif image_format == 'PNG':
                    normalized.save(output, format='PNG', optimize=True)
                    content_type = 'image/png'
                else:
                    if normalized.mode not in {'RGB', 'RGBA'}:
                        normalized = normalized.convert('RGBA' if 'A' in normalized.getbands() else 'RGB')
                    normalized.save(output, format='WEBP', quality=90, method=4)
                    content_type = 'image/webp'
                return output.getvalue(), content_type
    except ValueError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError('image_dimensions_exceed_limit') from error
    except (UnidentifiedImageError, OSError, SyntaxError) as error:
        raise ValueError('invalid_image') from error


def _attachment_directory(database_path: Path) -> Path:
    return database_path.with_suffix('.uploads')


def _attachment_paths(database_path: Path, attachment_id: str, content_type: str) -> tuple[Path, Path, Path] | None:
    extension = ATTACHMENT_MIME_EXTENSIONS.get(content_type)
    if not ATTACHMENT_ID_PATTERN.fullmatch(attachment_id) or not extension:
        return None
    root = _attachment_directory(database_path).resolve()
    file_name = f'{attachment_id}.{extension}'
    active_path = (root / file_name).resolve()
    trash_path = (root / '.trash' / file_name).resolve()
    if active_path.parent != root or trash_path.parent != root / '.trash':
        return None
    return root, active_path, trash_path


def _attachment_references(state: dict[str, object], attachment_id: str) -> list[tuple[dict[str, object], int]]:
    references: list[tuple[dict[str, object], int]] = []
    history = state.get('history')
    if not isinstance(history, list):
        return references
    for entry in history:
        if not isinstance(entry, dict):
            continue
        images = entry.get('imageFileIDs')
        if not isinstance(images, list):
            continue
        for index, image in enumerate(images):
            if isinstance(image, dict) and image.get('fileID') == attachment_id:
                references.append((entry, index))
    return references


def _validate_attachment_links(db: sqlite3.Connection, state: dict[str, object]) -> None:
    history = state.get('history')
    if not isinstance(history, list):
        return
    for entry in history:
        if not isinstance(entry, dict):
            continue
        images = entry.get('imageFileIDs')
        if images is None:
            continue
        if not isinstance(images, list) or len(images) > MAX_ATTACHMENTS_PER_HISTORY:
            raise ValueError('history imageFileIDs must contain at most six images')
        for image in images:
            if not isinstance(image, dict) or not isinstance(image.get('fileID'), str):
                continue
            attachment_id = image['fileID']
            if not ATTACHMENT_ID_PATTERN.fullmatch(attachment_id):
                continue  # Keep legacy cloud:// references readable as historical data.
            row = db.execute('SELECT history_id, deleted_at FROM attachments WHERE id = ?',
                             (attachment_id,)).fetchone()
            if (not row or row['deleted_at'] is not None or
                    entry.get('id') != row['history_id']):
                raise ValueError('history image attachment is missing, deleted, or owned by another record')


def _as_number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return 0
    try:
        number = float(value)
        return number if math.isfinite(number) else 0
    except (TypeError, ValueError):
        return 0


async def _amap_get_json(path: str, params: dict[str, str]) -> dict[str, object]:
    async with httpx.AsyncClient(timeout=AMAP_REQUEST_TIMEOUT_SECONDS, follow_redirects=False,
                                 trust_env=False) as client:
        response = await client.get('https://restapi.amap.com' + path, params=params)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError('Invalid weather provider response')
    return payload


def _public_ip_addresses(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        if host.lower() == 'localhost' or host.lower().endswith('.localhost'):
            raise ValueError('AI endpoint host is not public')
        try:
            records = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        except OSError as error:
            raise ValueError('AI endpoint host could not be resolved') from error
        addresses = [ipaddress.ip_address(record[4][0]) for record in records]
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError('AI endpoint host is not public')
    return addresses


def _build_public_chat_url(endpoint: str) -> str:
    value = endpoint.strip()
    if not value:
        raise ValueError('AI endpoint is not configured')
    if '://' not in value:
        value = 'https://' + value
    parsed = urlsplit(value)
    if (parsed.scheme.lower() != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ValueError('AI endpoint must be a public HTTPS URL without credentials or query values')
    try:
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError('AI endpoint port is invalid')
    except ValueError as error:
        raise ValueError('AI endpoint port is invalid') from error
    _public_ip_addresses(parsed.hostname)
    path = parsed.path.rstrip('/')
    if not path.endswith('/chat/completions'):
        path += '/chat/completions'
    return urlunsplit(('https', parsed.netloc, path or '/chat/completions', '', ''))


async def _validated_chat_url(endpoint: str) -> str:
    return await asyncio.to_thread(_build_public_chat_url, endpoint)


def _apply_model_options(payload: dict[str, object], purpose: str, model: str, endpoint: str) -> None:
    # Keep the mini-program's per-purpose sampling and provider thinking switches.
    payload['temperature'] = 0.1 if purpose in {'parse', 'note'} else 0.85 if purpose == 'quote' else 0.5
    name, host = model.lower(), endpoint.lower()
    if name in {'qwen3.7-max-preview', 'qwen3.7-max-2026-05-17', 'qwen3.8-max-preview'}:
        return
    if 'dashscope' in host or name.startswith(('qwen', 'kimi')):
        payload['enable_thinking'] = False
    elif 'api.deepseek.com' in host or 'bigmodel.cn' in host or name.startswith(('deepseek-v4-', 'glm-')):
        payload['thinking'] = {'type': 'disabled'}


async def _post_ai_chat(url: str, api_key: str, payload: dict[str, object]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT_SECONDS, follow_redirects=False,
                                 trust_env=False) as client:
        return await client.post(url, json=payload, headers={
            'Authorization': 'Bearer ' + api_key,
            'Content-Type': 'application/json',
        })


async def _read_limited_body(request: Request, limit: int) -> bytes:
    declared_length = request.headers.get('content-length')
    if declared_length:
        try:
            if int(declared_length) > limit:
                raise HTTPException(status_code=413, detail={'code': 'request_too_large'})
        except ValueError:
            raise HTTPException(status_code=400, detail={'code': 'invalid_content_length'})
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > limit:
            raise HTTPException(status_code=413, detail={'code': 'request_too_large'})
        body.extend(chunk)
    return bytes(body)


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
            'CREATE TABLE IF NOT EXISTS attachments ('
            'id TEXT PRIMARY KEY, history_id TEXT NOT NULL, content_type TEXT NOT NULL, '
            'caption TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER)'
        )
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

    def check_origin(request: Request, *, required: bool = False) -> None:
        origin = request.headers.get('origin')
        if not origin:
            if required:
                raise HTTPException(status_code=403, detail='Origin is required')
            return
        expected = config.allowed_origin
        if expected:
            valid = origin.rstrip('/') == expected.rstrip('/')
        else:
            parsed = urlparse(origin)
            valid = parsed.scheme == request.url.scheme and parsed.netloc == request.headers.get('host')
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

    def persist_attachment_state(db: sqlite3.Connection, current_revision: int,
                                 state: dict[str, object]) -> int:
        try:
            validate_state(state, SEED)
            _validate_attachment_links(db, state)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        revision = current_revision + 1
        db.execute('UPDATE app_state SET revision=?, payload=? WHERE id=1',
                   (revision, json.dumps(state, ensure_ascii=False, separators=(',', ':'))))
        return revision

    def replace_state_with_backup(base_revision: int, new_state: dict[str, object],
                                  *, clear_key: bool = False) -> int:
        with database(config.database_path) as db:
            row = db.execute('SELECT revision FROM app_state WHERE id=1').fetchone()
            if not row or row['revision'] != base_revision:
                raise HTTPException(status_code=409, detail='State revision changed')
        try:
            snapshot_database(config.database_path)
        except OSError as error:
            raise HTTPException(status_code=503, detail='Could not create a safety backup') from error
        with database(config.database_path) as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT revision FROM app_state WHERE id=1').fetchone()
            if row['revision'] != base_revision:
                raise HTTPException(status_code=409, detail='State revision changed')
            try:
                validate_state(new_state, SEED)
                _validate_attachment_links(db, new_state)
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            revision = row['revision'] + 1
            db.execute('UPDATE app_state SET revision=?, payload=? WHERE id=1',
                       (revision, serialize_state(new_state)))
            db.execute('CREATE TABLE IF NOT EXISTS processed_mutations (mutation_id TEXT PRIMARY KEY)')
            db.execute('DELETE FROM processed_mutations')
            if clear_key:
                db.execute('DELETE FROM secrets WHERE name="llm_api_key"')
        return revision

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

    @application.get('/api/weather')
    async def weather(request: Request, response: Response,
                      city: str | None = Query(default=None, max_length=100),
                      latitude: float | None = None, longitude: float | None = None,
                      _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request)
        response.headers['Cache-Control'] = 'no-store'
        if not config.amap_key:
            return {'success': False, 'error': 'Weather service is not configured'}

        with database(config.database_path) as db:
            state_row = db.execute('SELECT payload FROM app_state WHERE id = 1').fetchone()
        state = json.loads(state_row['payload']) if state_row else {}
        profile = state.get('profile') if isinstance(state.get('profile'), dict) else {}
        profile_city = profile.get('city') if isinstance(profile.get('city'), str) else ''
        profile_city = profile_city.strip()[:100]
        requested_city = (city or '').strip()
        candidates: list[tuple[str, str | None]] = []

        coordinates_valid = (
            latitude is not None and longitude is not None
            and math.isfinite(latitude) and math.isfinite(longitude)
            and -90 <= latitude <= 90 and -180 <= longitude <= 180
        )
        if coordinates_valid:
            try:
                geo = await _amap_get_json('/v3/geocode/regeo', {
                    'key': config.amap_key,
                    'location': f'{longitude},{latitude}',
                    'extensions': 'base',
                })
                regeocode = geo.get('regeocode') if geo.get('status') == '1' else None
                component = regeocode.get('addressComponent') if isinstance(regeocode, dict) else None
                if isinstance(component, dict):
                    resolved_city = component.get('city')
                    if not isinstance(resolved_city, str) or not resolved_city.strip():
                        resolved_city = component.get('province')
                    adcode = component.get('adcode')
                    if isinstance(resolved_city, str) and resolved_city.strip() and adcode:
                        candidates.append((resolved_city.strip()[:100], str(adcode)))
            except Exception:
                # Location lookup is best-effort; the saved or requested city remains usable.
                pass

        for fallback_city in (profile_city, requested_city):
            if fallback_city and all(existing_city != fallback_city for existing_city, _ in candidates):
                candidates.append((fallback_city, None))

        for candidate_city, adcode in candidates:
            try:
                if not adcode:
                    geocode = await _amap_get_json('/v3/geocode/geo', {
                        'key': config.amap_key,
                        'address': candidate_city,
                    })
                    geocodes = geocode.get('geocodes') if geocode.get('status') == '1' else None
                    first = geocodes[0] if isinstance(geocodes, list) and geocodes else None
                    adcode = first.get('adcode') if isinstance(first, dict) else None
                    if not adcode:
                        continue

                weather_result = await _amap_get_json('/v3/weather/weatherInfo', {
                    'key': config.amap_key,
                    'city': str(adcode),
                    'extensions': 'base',
                })
                lives = weather_result.get('lives') if weather_result.get('status') == '1' else None
                live = lives[0] if isinstance(lives, list) and lives else None
                if not isinstance(live, dict):
                    continue
                temperature = _as_number(live.get('temperature'))
                return {'success': True, 'data': {
                    'temp': temperature,
                    'feelsLike': temperature,
                    'humidity': _as_number(live.get('humidity')),
                    'desc': live.get('weather') if isinstance(live.get('weather'), str) else '',
                    'wind': 0,
                    'winddirection': live.get('winddirection') if isinstance(live.get('winddirection'), str) else '',
                    'windpower': live.get('windpower') if isinstance(live.get('windpower'), str) else '',
                    'city': candidate_city,
                    'reporttime': live.get('reporttime') if isinstance(live.get('reporttime'), str) else '',
                }}
            except Exception:
                # Provider errors should leave rule-based recommendations usable.
                continue
        return {'success': False, 'error': 'Weather is unavailable for this location'}

    @application.post('/api/ai/chat')
    async def ai_chat(request: Request, response: Response,
                      _: str = Depends(authenticated_session)) -> dict[str, str]:
        check_origin(request, required=True)
        response.headers['Cache-Control'] = 'no-store'
        if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
            raise HTTPException(status_code=415, detail={'code': 'invalid_content_type'})
        raw_body = await _read_limited_body(request, AI_BODY_LIMIT)
        try:
            body = AIChatBody.model_validate_json(raw_body)
        except ValidationError as error:
            raise HTTPException(status_code=422, detail={'code': 'invalid_request'}) from error

        with database(config.database_path) as db:
            row = db.execute('SELECT payload FROM app_state WHERE id = 1').fetchone()
            secret = db.execute('SELECT ciphertext FROM secrets WHERE name = "llm_api_key"').fetchone()
        if not row:
            raise HTTPException(status_code=503, detail={'code': 'ai_configuration_unavailable'})
        state = json.loads(row['payload'])
        llm = state.get('llm') if isinstance(state.get('llm'), dict) else {}

        purpose = body.purpose
        if purpose == 'parse':
            if not llm.get('parserEnabled'):
                raise HTTPException(status_code=503, detail={'code': 'ai_purpose_disabled'})
            model = llm.get('parserModel')
        elif purpose == 'note':
            if llm.get('noteAnalysisEnabled') is False:
                raise HTTPException(status_code=503, detail={'code': 'ai_purpose_disabled'})
            model = llm.get('parserModel')
        elif purpose in {'recommend', 'coarse'}:
            if not llm.get('enabled'):
                raise HTTPException(status_code=503, detail={'code': 'ai_purpose_disabled'})
            model = llm.get('recModel')
        else:  # quote follows the mini-program behavior: recModel, then parserModel.
            model = llm.get('recModel') or llm.get('parserModel')

        if not isinstance(llm.get('endpoint'), str) or not llm['endpoint'].strip():
            raise HTTPException(status_code=503, detail={'code': 'ai_endpoint_not_configured'})
        if len(llm['endpoint']) > 2048:
            raise HTTPException(status_code=503, detail={'code': 'ai_endpoint_invalid'})
        if not isinstance(model, str) or not model.strip() or len(model) > 200:
            raise HTTPException(status_code=503, detail={'code': 'ai_model_not_configured'})
        if not secret:
            raise HTTPException(status_code=503, detail={'code': 'ai_key_not_configured'})
        if not config.encryption_key:
            raise HTTPException(status_code=503, detail={'code': 'ai_key_unavailable'})
        try:
            api_key = Fernet(config.encryption_key.encode('ascii')).decrypt(
                secret['ciphertext'].encode('ascii')).decode('utf-8')
        except (InvalidToken, ValueError, UnicodeError):
            raise HTTPException(status_code=503, detail={'code': 'ai_key_unavailable'})

        try:
            chat_url = await _validated_chat_url(llm['endpoint'])
        except (ValueError, OSError, UnicodeError):
            raise HTTPException(status_code=503, detail={'code': 'ai_endpoint_invalid'})

        outgoing = {
            'model': model.strip(),
            'messages': [message.model_dump() for message in body.messages],
            'max_tokens': body.maxTokens if body.maxTokens is not None else 1200,
        }
        _apply_model_options(outgoing, purpose, model, llm['endpoint'])
        try:
            upstream = await asyncio.wait_for(
                _post_ai_chat(chat_url, api_key, outgoing), timeout=AI_REQUEST_TIMEOUT_SECONDS)
        except (httpx.TimeoutException, asyncio.TimeoutError):
            raise HTTPException(status_code=504, detail={'code': 'ai_provider_timeout'})
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail={'code': 'ai_provider_unavailable'})

        if upstream.status_code == 429:
            raise HTTPException(status_code=429, detail={'code': 'ai_provider_rate_limited'})
        if upstream.status_code in {401, 403}:
            raise HTTPException(status_code=502, detail={'code': 'ai_provider_auth_failed'})
        if upstream.status_code >= 500:
            raise HTTPException(status_code=502, detail={'code': 'ai_provider_unavailable'})
        if upstream.status_code < 200 or upstream.status_code >= 300:
            raise HTTPException(status_code=502, detail={'code': 'ai_provider_rejected_request'})
        try:
            provider_body = upstream.json()
            choices = provider_body.get('choices') if isinstance(provider_body, dict) else None
            choice = choices[0] if isinstance(choices, list) and choices else None
            message = choice.get('message') if isinstance(choice, dict) else None
            content = message.get('content') if isinstance(message, dict) else None
            if not isinstance(content, str) or len(content) > 100_000:
                raise ValueError('Invalid AI content')
        except (ValueError, TypeError):
            raise HTTPException(status_code=502, detail={'code': 'ai_provider_invalid_response'})
        return {'content': content}

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
            stamp = int(time.time() * 1000)
            if section == 'profile':
                state['profileUpdatedAt'] = stamp
            elif section == 'settings':
                state['settingsUpdatedAt'] = stamp
            elif section == 'teaLibrary':
                if isinstance(value, list):
                    old_ids = {tea['id'] for tea in state['teaLibrary'] if isinstance(tea, dict) and isinstance(tea.get('id'), int)}
                    new_ids = {tea['id'] for tea in value if isinstance(tea, dict) and isinstance(tea.get('id'), int)}
                    removed_ids = old_ids - new_ids
                    if removed_ids:
                        state['knowledgeOverrides'] = {key: item for key, item in state['knowledgeOverrides'].items()
                                                       if item.get('teaId') not in removed_ids}
                        for item in state['inventory']:
                            if item.get('teaId') in removed_ids and not item.get('deletedAt'):
                                item['deletedAt'] = stamp
                                item['updatedAt'] = stamp
                state['teaLibraryUpdatedAt'] = stamp
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
                    candidate = mutation
                    if mutation.get('type') == 'upsert_history' and isinstance(mutation.get('value'), dict):
                        value = dict(mutation['value'])
                        if 'imageFileIDs' not in value:
                            previous = next((entry for entry in state['history']
                                             if isinstance(entry, dict) and entry.get('id') == mutation.get('entityId')),
                                            None)
                            if isinstance(previous, dict) and 'imageFileIDs' in previous:
                                value['imageFileIDs'] = previous['imageFileIDs']
                        candidate = {**mutation, 'value': value}
                    apply_mutation(state, candidate)
                    db.execute('INSERT INTO processed_mutations(mutation_id) VALUES(?)', (mutation_id,))
                    applied.append({'mutationId': mutation_id, 'duplicate': False})
                validate_state(state, SEED)
                _validate_attachment_links(db, state)
            except ValueError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
            revision = row['revision'] + 1
            db.execute('UPDATE app_state SET revision=?, payload=? WHERE id=1',
                       (revision, json.dumps(state, ensure_ascii=False, separators=(',', ':'))))
        return {'revision': revision, 'results': applied}

    @application.post('/api/data/import')
    async def import_pwa_data(request: Request, response: Response,
                              _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request, required=True)
        response.headers['Cache-Control'] = 'no-store'
        if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
            raise HTTPException(status_code=415, detail='JSON is required')
        raw = await _read_limited_body(request, 8 * 1024 * 1024)
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError('Import request must be an object')
            base_revision = payload.get('baseRevision')
            if not isinstance(base_revision, int) or isinstance(base_revision, bool) or base_revision < 0:
                raise ValueError('baseRevision is required')
            imported = parse_pwa_export(payload.get('data'), SEED)
        except (ValueError, UnicodeDecodeError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        revision = replace_state_with_backup(base_revision, imported)
        return {'revision': revision, 'imported': True, 'backupCreated': True}

    @application.post('/api/data/reset')
    def reset_pwa_data(body: DataResetBody, request: Request, response: Response,
                       _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request, required=True)
        response.headers['Cache-Control'] = 'no-store'
        revision = replace_state_with_backup(body.baseRevision, default_state(SEED), clear_key=True)
        return {'revision': revision, 'reset': True, 'backupCreated': True}

    @application.post('/api/knowledge/install')
    async def install_knowledge(request: Request, response: Response,
                                _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request, required=True)
        response.headers['Cache-Control'] = 'no-store'
        if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
            raise HTTPException(status_code=415, detail='JSON is required')
        raw = await _read_limited_body(request, 6 * 1024 * 1024)
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError('Knowledge request must be an object')
            base_revision = payload.get('baseRevision')
            if not isinstance(base_revision, int) or isinstance(base_revision, bool) or base_revision < 0:
                raise ValueError('baseRevision is required')
        except (ValueError, UnicodeDecodeError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        with database(config.database_path) as db:
            row = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
        if not row or row['revision'] != base_revision:
            raise HTTPException(status_code=409, detail='State revision changed')
        try:
            candidate = prepare_knowledge_install(payload.get('catalog'), json.loads(row['payload']), SEED)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        with database(config.database_path) as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT revision FROM app_state WHERE id=1').fetchone()
            if current['revision'] != base_revision:
                raise HTTPException(status_code=409, detail='State revision changed')
            revision = current['revision'] + 1
            db.execute('UPDATE app_state SET revision=?, payload=? WHERE id=1',
                       (revision, serialize_state(candidate)))
        return {'revision': revision, 'installed': True,
                'catalogVersion': candidate['knowledgeBase']['catalogVersion']}

    @application.post('/api/attachments', status_code=201)
    async def upload_attachment(request: Request, response: Response,
                                history_id: Annotated[str, Query(alias='historyId', min_length=1, max_length=200)],
                                base_revision: Annotated[int, Query(alias='baseRevision', ge=0)],
                                caption: Annotated[str, Query(max_length=MAX_ATTACHMENT_CAPTION_LENGTH)] = '',
                                _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request)
        response.headers['Cache-Control'] = 'no-store'
        declared_type = request.headers.get('content-type', '').split(';', 1)[0].strip().lower()
        if declared_type and declared_type not in {*ATTACHMENT_MIME_EXTENSIONS, 'application/octet-stream'}:
            raise HTTPException(status_code=415, detail={'code': 'unsupported_image_format'})
        raw = await _read_limited_body(request, MAX_ATTACHMENT_BYTES)
        if not raw:
            raise HTTPException(status_code=422, detail={'code': 'empty_image'})
        try:
            cleaned, content_type = await asyncio.to_thread(_sanitize_image, raw)
        except ValueError as error:
            code = str(error)
            status = 413 if code == 'image_dimensions_exceed_limit' else 415
            raise HTTPException(status_code=status, detail={'code': code}) from error
        if declared_type not in {'', 'application/octet-stream', content_type}:
            raise HTTPException(status_code=415, detail={'code': 'image_type_mismatch'})
        if len(cleaned) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=413, detail={'code': 'request_too_large'})

        directory = _attachment_directory(config.database_path).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        created_path: Path | None = None
        attachment_id = ''
        revision = base_revision
        try:
            with database(config.database_path) as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
                if row['revision'] != base_revision:
                    raise HTTPException(status_code=409, detail='State revision changed')
                state = json.loads(row['payload'])
                records = [entry for entry in state.get('history', [])
                           if isinstance(entry, dict) and entry.get('id') == history_id]
                if not records:
                    raise HTTPException(status_code=404, detail={'code': 'history_record_not_found'})
                if len(records) != 1:
                    raise HTTPException(status_code=409, detail={'code': 'history_record_id_ambiguous'})
                record = records[0]
                images = record.get('imageFileIDs', [])
                if not isinstance(images, list):
                    raise HTTPException(status_code=422, detail={'code': 'invalid_history_images'})
                if len(images) >= MAX_ATTACHMENTS_PER_HISTORY:
                    raise HTTPException(status_code=409, detail={'code': 'attachment_limit_reached'})

                extension = ATTACHMENT_MIME_EXTENSIONS[content_type]
                for _attempt in range(5):
                    attachment_id = 'att_' + secrets.token_hex(16)
                    paths = _attachment_paths(config.database_path, attachment_id, content_type)
                    if not paths:
                        continue
                    _, candidate_path, _ = paths
                    try:
                        with candidate_path.open('xb') as output:
                            output.write(cleaned)
                        created_path = candidate_path
                        break
                    except FileExistsError:
                        continue
                if created_path is None:
                    raise HTTPException(status_code=503, detail={'code': 'attachment_storage_unavailable'})

                images.append({'fileID': attachment_id, 'caption': caption})
                record['imageFileIDs'] = images
                db.execute('INSERT INTO attachments(id, history_id, content_type, caption, created_at) '
                           'VALUES(?, ?, ?, ?, ?)',
                           (attachment_id, history_id, content_type, caption, int(time.time() * 1000)))
                revision = persist_attachment_state(db, row['revision'], state)
        except Exception:
            if created_path is not None:
                created_path.unlink(missing_ok=True)
            raise

        return {'id': attachment_id, 'fileID': attachment_id, 'historyId': history_id,
                'url': f'/api/attachments/{attachment_id}', 'contentType': content_type,
                'caption': caption, 'size': len(cleaned), 'revision': revision}

    @application.get('/api/attachments/{attachment_id}')
    def read_attachment(attachment_id: str, request: Request,
                        _: str = Depends(authenticated_session)) -> Response:
        check_origin(request)
        if not ATTACHMENT_ID_PATTERN.fullmatch(attachment_id):
            raise HTTPException(status_code=404, detail='Attachment not found')
        with database(config.database_path) as db:
            row = db.execute('SELECT history_id, content_type, deleted_at FROM attachments WHERE id=?',
                             (attachment_id,)).fetchone()
            if not row or row['deleted_at'] is not None:
                raise HTTPException(status_code=404, detail='Attachment not found')
            paths = _attachment_paths(config.database_path, attachment_id, row['content_type'])
            if not paths:
                raise HTTPException(status_code=404, detail='Attachment not found')
            _, file_path, _ = paths
            state_row = db.execute('SELECT payload FROM app_state WHERE id=1').fetchone()
            state = json.loads(state_row['payload']) if state_row else {}
            references = _attachment_references(state, attachment_id)
            if (len(references) != 1 or references[0][0].get('id') != row['history_id'] or
                    not file_path.is_file()):
                raise HTTPException(status_code=404, detail='Attachment not found')
            image_bytes = file_path.read_bytes()
        return Response(content=image_bytes, media_type=row['content_type'], headers={
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': 'inline',
        })

    @application.patch('/api/attachments/{attachment_id}')
    def update_attachment_caption(attachment_id: str, body: AttachmentCaptionBody, request: Request,
                                  response: Response,
                                  _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request)
        response.headers['Cache-Control'] = 'no-store'
        if not ATTACHMENT_ID_PATTERN.fullmatch(attachment_id):
            raise HTTPException(status_code=404, detail='Attachment not found')
        with database(config.database_path) as db:
            db.execute('BEGIN IMMEDIATE')
            attachment = db.execute('SELECT history_id, deleted_at FROM attachments WHERE id=?',
                                    (attachment_id,)).fetchone()
            if not attachment or attachment['deleted_at'] is not None:
                raise HTTPException(status_code=404, detail='Attachment not found')
            row = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
            if row['revision'] != body.baseRevision:
                raise HTTPException(status_code=409, detail='State revision changed')
            state = json.loads(row['payload'])
            references = _attachment_references(state, attachment_id)
            if len(references) != 1 or references[0][0].get('id') != attachment['history_id']:
                raise HTTPException(status_code=409, detail={'code': 'attachment_reference_conflict'})
            entry, image_index = references[0]
            entry['imageFileIDs'][image_index]['caption'] = body.caption
            db.execute('UPDATE attachments SET caption=? WHERE id=?', (body.caption, attachment_id))
            revision = persist_attachment_state(db, row['revision'], state)
        return {'id': attachment_id, 'fileID': attachment_id,
                'historyId': attachment['history_id'], 'caption': body.caption,
                'revision': revision}

    @application.delete('/api/attachments/{attachment_id}')
    def delete_attachment(attachment_id: str, request: Request, response: Response,
                          base_revision: Annotated[int, Query(alias='baseRevision', ge=0)],
                          _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request)
        response.headers['Cache-Control'] = 'no-store'
        if not ATTACHMENT_ID_PATTERN.fullmatch(attachment_id):
            raise HTTPException(status_code=404, detail='Attachment not found')
        paths: tuple[Path, Path, Path] | None = None
        with database(config.database_path) as db:
            db.execute('BEGIN IMMEDIATE')
            attachment = db.execute('SELECT history_id, content_type, deleted_at FROM attachments WHERE id=?',
                                    (attachment_id,)).fetchone()
            if not attachment:
                raise HTTPException(status_code=404, detail='Attachment not found')
            state_row = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
            if state_row['revision'] != base_revision:
                raise HTTPException(status_code=409, detail='State revision changed')
            if attachment['deleted_at'] is not None:
                paths = _attachment_paths(config.database_path, attachment_id, attachment['content_type'])
                revision = state_row['revision'] if state_row else 0
            else:
                row = state_row
                state = json.loads(row['payload'])
                references = _attachment_references(state, attachment_id)
                if len(references) > 1:
                    raise HTTPException(status_code=409, detail={'code': 'attachment_referenced_elsewhere'})
                if references and references[0][0].get('id') != attachment['history_id']:
                    raise HTTPException(status_code=409, detail={'code': 'attachment_reference_conflict'})
                paths = _attachment_paths(config.database_path, attachment_id, attachment['content_type'])
                if not paths:
                    raise HTTPException(status_code=404, detail='Attachment not found')
                if references:
                    entry, image_index = references[0]
                    entry['imageFileIDs'].pop(image_index)
                    revision = persist_attachment_state(db, row['revision'], state)
                else:
                    revision = row['revision']
                db.execute('UPDATE attachments SET deleted_at=? WHERE id=?',
                           (int(time.time() * 1000), attachment_id))

        assert paths is not None
        _, active_path, trash_path = paths
        trash_path.parent.mkdir(parents=True, exist_ok=True)
        if active_path.is_file() and not trash_path.exists():
            try:
                os.replace(active_path, trash_path)
            except OSError:
                # The history reference is already detached; the retained file can be moved later.
                pass
        return {'deleted': True, 'recoverable': active_path.is_file() or trash_path.is_file(),
                'cleanupPending': active_path.is_file(), 'revision': revision}

    @application.post('/api/attachments/{attachment_id}/restore')
    def restore_attachment(attachment_id: str, body: AttachmentRestoreBody, request: Request,
                           response: Response,
                           _: str = Depends(authenticated_session)) -> dict[str, object]:
        check_origin(request)
        response.headers['Cache-Control'] = 'no-store'
        if not ATTACHMENT_ID_PATTERN.fullmatch(attachment_id):
            raise HTTPException(status_code=404, detail='Attachment not found')
        moved_from_trash = False
        active_path: Path | None = None
        trash_path: Path | None = None
        try:
            with database(config.database_path) as db:
                db.execute('BEGIN IMMEDIATE')
                attachment = db.execute('SELECT history_id, content_type, caption, deleted_at FROM attachments WHERE id=?',
                                        (attachment_id,)).fetchone()
                if not attachment or attachment['deleted_at'] is None:
                    raise HTTPException(status_code=404, detail='Deleted attachment not found')
                row = db.execute('SELECT revision, payload FROM app_state WHERE id=1').fetchone()
                if row['revision'] != body.baseRevision:
                    raise HTTPException(status_code=409, detail='State revision changed')
                state = json.loads(row['payload'])
                records = [entry for entry in state.get('history', [])
                           if isinstance(entry, dict) and entry.get('id') == attachment['history_id']]
                if len(records) != 1:
                    raise HTTPException(status_code=409, detail={'code': 'history_record_unavailable'})
                record = records[0]
                images = record.get('imageFileIDs', [])
                if not isinstance(images, list):
                    raise HTTPException(status_code=422, detail={'code': 'invalid_history_images'})
                if len(images) >= MAX_ATTACHMENTS_PER_HISTORY:
                    raise HTTPException(status_code=409, detail={'code': 'attachment_limit_reached'})
                if _attachment_references(state, attachment_id):
                    raise HTTPException(status_code=409, detail={'code': 'attachment_already_referenced'})
                paths = _attachment_paths(config.database_path, attachment_id, attachment['content_type'])
                if not paths:
                    raise HTTPException(status_code=404, detail='Attachment not found')
                _, active_path, trash_path = paths
                if not active_path.is_file() and trash_path.is_file():
                    os.replace(trash_path, active_path)
                    moved_from_trash = True
                elif not active_path.is_file():
                    raise HTTPException(status_code=404, detail={'code': 'attachment_file_missing'})
                images.append({'fileID': attachment_id, 'caption': attachment['caption']})
                record['imageFileIDs'] = images
                db.execute('UPDATE attachments SET deleted_at=NULL WHERE id=?', (attachment_id,))
                revision = persist_attachment_state(db, row['revision'], state)
        except Exception:
            if moved_from_trash and active_path is not None and trash_path is not None and active_path.exists():
                try:
                    os.replace(active_path, trash_path)
                except OSError:
                    pass
            raise
        return {'id': attachment_id, 'fileID': attachment_id,
                'historyId': attachment['history_id'], 'url': f'/api/attachments/{attachment_id}',
                'contentType': attachment['content_type'], 'caption': attachment['caption'],
                'revision': revision}

    return application


def catalog_to_knowledge_base(catalog: dict[str, object]) -> dict[str, object]:
    teas = catalog.get('teas', [])
    return {'schemaVersion': catalog.get('schemaVersion'), 'catalogVersion': catalog.get('catalogVersion'),
            'sourceGeneratedAt': catalog.get('generatedAt'), 'importedAt': 0,
            'profilesByTeaId': {str(profile['teaId']): profile for profile in teas},
            'withheldTeaIds': catalog.get('withheldTeaIds', []),
            'validationSummary': {'profileCount': len(teas), 'expectedTeaCount': catalog.get('expectedTeaCount')}}

app = create_app()
