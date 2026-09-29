# PWA server data API

The server is a single-user FastAPI application backed by one SQLite database. It stores one versioned JSON state row; it does not split each business field into a table. The built-in tea list and knowledge catalog come from `seed.json` and remain the defaults on first run.

## Configuration

Copy `.env.example` to `.env`. Set `APP_PASSWORD_HASH`, `APP_ENCRYPTION_KEY`, `DATA_DIR`, and a private `AMAP_KEY` if weather lookup is enabled. Generate the password hash with `python -m server.create_password_hash`. Generate the encryption key with:

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep passwords and provider keys private. Store real values only in the ignored local `.env`; `.env.example` contains placeholders only. Back up `APP_ENCRYPTION_KEY` with the SQLite file. Losing it makes the separately encrypted AI key unreadable.

For local development, run these from the repository root (the example uses a non-secure cookie only on localhost):

```powershell
python -m pip install -r server/requirements-dev.txt
Copy-Item server/.env.example server/.env
python -m server.create_password_hash
```

Put the generated password hash and encryption key into `server/.env`, then start the API:

```powershell
python -m uvicorn server.app:app --reload --port 8000
```

In a second terminal, start the frontend with `cd web`, `npm ci`, and `npm run dev`, then open `http://127.0.0.1:5173/`. The app includes recommendations, history, tea library, statistics, and settings. Weather is optional: without `AMAP_KEY`, or when AMap is unavailable, it reports that weather is unavailable and rule-based recommendations still work. PWA installation, offline writes, old mini-program data import, and deployment remain later migration steps.

## Authentication and responses

- `GET /api/healthz` is public and returns `204` with `Cache-Control: no-store`.
- `POST /api/login` accepts `{"password":"..."}`. A successful login sets the protected `tea_session` HttpOnly cookie.
- `GET /api/session` reports `{"authenticated":true|false}`.
- `POST /api/logout` requires a session and clears it.
- All state and mutation routes below require that session. Write routes check `Origin` when supplied. State responses use `Cache-Control: no-store`.
- Requests with no session get `401`; invalid state gets `422`; an outdated `baseRevision` gets `409` and must be refreshed before retry.

## State contract

`GET /api/state` returns `{"revision":0,"state":{...}}`. `schemaVersion` is currently `2`. The response contains `profile`, `settings`, `teaLibrary`, `history`, `temporaryAvoids`, `inventory`, `knowledgeOverrides`, `knowledgeBase`, and non-secret `llm` configuration. `knowledgeBase` is the effective directory: when no personal package is installed, the server constructs it from the built-in catalog in `seed.json`. The seed also bundles its validation contract, so the running API does not depend on the mini-program source tree. That catalog has 86 complete profiles and is about 1 MB; it is included in state responses so clients have one consistent effective value. This is the only large static section.

Each state write uses:

```json
{"baseRevision":0,"value":{"avoidDays":5}}
```

`PATCH /api/state/{section}` accepts `profile`, `settings`, `teaLibrary`, `inventory`, `knowledgeOverrides`, `knowledgeBase`, or `llm`. It replaces that section and increments `revision` in the same SQLite transaction. Unknown sections are rejected. Defaults follow `utils/data.js`: `avoidDays=5`, empty history/avoids/inventory/overrides, the seeded tea list and catalog, and the current default models.

`profile` fields are `gender`, `age`, `city`, `constitution`, and `quizAnswers`. `settings` contains `avoidDays` (integer 1–30; booleans are not accepted as integers). `teaLibrary` must be a non-empty list with unique integer IDs and a name/category per tea. LLM options contain the booleans `enabled`, `parserEnabled`, `noteAnalysisEnabled`, `twoStageRecommendationEnabled`, plus `endpoint`, `recModel`, and `parserModel` strings.

The AI key is accepted only as `llm.apiKey` on a write. It is encrypted with Fernet and stored in a separate SQLite `secrets` row; an empty string removes it. Reads never return the key and instead include `llm.apiKeyConfigured`. The previous inline `llm.apiKey` from version 1 is encrypted during startup migration; if one exists, startup requires the same `APP_ENCRYPTION_KEY` setting. Unknown state fields and unknown LLM keys are discarded during migration or rejected on write.

## Weather and AI proxy

`GET /api/weather?city=苏州&latitude=31.30&longitude=120.58` requires a session. When both coordinates are valid, the server tries AMap reverse geocoding first. If that fails, or its weather lookup fails, it tries the saved profile city and then the requested city. A successful response keeps the mini-program shape:

```json
{"success":true,"data":{"temp":22,"feelsLike":22,"humidity":60,"desc":"多云","wind":0,"winddirection":"东风","windpower":"≤3","city":"苏州市","reporttime":"2026-09-24 10:00:00"}}
```

When AMap is unconfigured or all lookups fail, it returns `{"success":false,"error":"..."}` without exposing the key or provider response. Weather is optional; the recommendation page can continue using local rules without it.

Browser geolocation reports WGS84 coordinates, while the old WeChat location flow may report GCJ-02. This proxy sends the supplied coordinates to AMap as-is, so a city result near an administrative boundary can differ; treat coordinate lookup as approximate city selection, not exact equivalence with the mini-program. The saved profile city and requested city remain fallbacks.

`POST /api/ai/chat` requires a session and a same-origin `Origin` header. Its body is limited to `purpose`, `messages`, and optional `maxTokens`:

```json
{"purpose":"recommend","messages":[{"role":"system","content":"..."},{"role":"user","content":"..."}],"maxTokens":1200}
```

Allowed purposes are `parse`, `recommend`, `coarse`, `quote`, and `note`. `parse` and `note` use `parserModel`; `recommend` and `coarse` use `recModel`; `quote` uses `recModel`, falling back to `parserModel` if it is empty. The relevant saved feature switch is enforced for parsing, recommendation, and note analysis. The request never accepts a model, URL, or API key from the browser. The configured OpenAI-compatible endpoint must use public HTTPS; localhost and private-address hosts, URL credentials/query values, and redirects are rejected. The provider key is decrypted only for the outbound request and is never included in responses or error messages.

Requests are capped at 64 KiB, 24 messages, 16,000 characters per message, 30,000 characters total, and 1–4,096 output tokens (1,200 by default). Provider calls time out after 30 seconds. Errors use a stable `detail.code` such as `ai_key_not_configured`, `ai_endpoint_invalid`, `ai_provider_timeout`, `ai_provider_rate_limited`, or `ai_provider_invalid_response`; provider error bodies are not forwarded. Browser callers may pass an `AbortController` signal to `fetch` to stop waiting for a request.

`knowledgeBase` uses `{schemaVersion,catalogVersion,sourceGeneratedAt,importedAt,profilesByTeaId,withheldTeaIds,validationSummary}`. Complete profiles and withheld IDs must partition the 89 seeded teas without gaps or overlap; a personal package may complete a previously withheld tea. Field values follow the contract bundled in `server/seed.json`, including legitimate `unknown` fields whose value is null. Incomplete or malformed profiles are rejected. Replacing it stores the effective previous directory in `knowledgeBaseBackup`. Tea library and personal overrides remain intact. To restore, write the backup value back as the next `knowledgeBase` section value; this makes the current value the new backup.

`knowledgeOverrides` maps each current tea ID to `{teaId,patch,lockedPaths,tombstones,updatedAt}`. Patch keys must be declared `section.field` paths and each value follows the same knowledge field contract. An override for a tea absent from `teaLibrary`, an invalid field value, or an undeclared path is rejected.

## History and temporary avoidance

`POST /api/mutations` accepts 1–100 operations in one atomic request:

```json
{
  "baseRevision": 0,
  "mutations": [
    {"mutationId":"client-generated-id","type":"upsert_history","entityId":"h_1","value":{"id":"h_1","date":"2026-09-23","teaId":1,"type":"primary"}},
    {"mutationId":"client-generated-id-2","type":"set_avoid","entityId":"1","value":{"active":true,"updatedAt":1780000000000}}
  ]
}
```

`upsert_history` replaces the entry with the same stable ID. `set_avoid` replaces one tea's full state, including inactive tombstones. The server records each `mutationId`; a replay returns `duplicate:true` and does not apply it again. An all-duplicate batch returns successfully even when its `baseRevision` is old and does not increment the revision; a stale batch containing any new mutation returns `409`. The response includes the resulting `revision` and one result per operation.

## History images

Image endpoints require login and check `Origin` when the browser supplies it. A history record must have one unique stable `id`; each record may reference at most six images. Captions are limited to 40 characters.

Upload the raw image bytes (not multipart form data) so the request body can be capped before decoding:

```http
POST /api/attachments?historyId=h_1&baseRevision=3&caption=春日香气
Content-Type: image/jpeg

<image bytes>
```

The request uses the current state revision. It returns a server-generated `fileID`, a same-origin `url`, the normalized media type, caption, byte size, and new revision. The server decodes and re-encodes static JPEG, PNG, and WebP images, applies EXIF orientation, and drops EXIF/GPS and other embedded metadata. HEIC and other formats, animated images, files over 5 MiB, and images over 40 megapixels are rejected. The declared `Content-Type` must match the detected format (or be `application/octet-stream`).

The image reference is stored in `history[].imageFileIDs` as `{"fileID":"att_<server-id>","caption":"..."}`. `GET /api/attachments/{fileID}` returns the image only while an active history record references it. `PATCH /api/attachments/{fileID}` accepts `{"baseRevision":4,"caption":"清甜回甘"}` and updates both the history JSON and attachment metadata atomically. Upload and caption changes increment the state revision.

`DELETE /api/attachments/{fileID}?baseRevision=5` checks the revision and refuses to delete when the ID is referenced by more than one record. It first removes the history reference and marks the attachment deleted in SQLite, then moves the file under `.trash/`; the file is retained for recovery, and `POST /api/attachments/{fileID}/restore` with `{"baseRevision":6}` restores it to its original record if the record still exists and has room. All previews use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

Image files are stored in a sibling directory next to the configured SQLite file. With the default `DATA_DIR`, the paths are `DATA_DIR/tea.sqlite3` and `DATA_DIR/tea.uploads/`. JSON export contains references and captions, not image bytes; a complete backup must include both the SQLite database and the upload directory. The scheduled full-backup workflow remains part of step 6.

## Settings data actions (step 4)

The browser exports a `tea-pwa-v1` JSON file from `GET /api/state`; the file omits the AI API key. `POST /api/data/import` accepts only a complete export of that same format, with `baseRevision` and a same-origin `Origin` header. It preserves the server's encrypted AI key. It does **not** import the old mini-program format. `POST /api/data/reset` also requires `baseRevision` and `Origin`; it restores the seed state and clears the encrypted AI key. Both actions create a SQLite snapshot in `DATA_DIR/backups/` before replacing state. Reset does not physically remove uploaded image files, so they remain recoverable but are no longer referenced by the new state.

`POST /api/knowledge/install` accepts a complete import-purpose package for all 89 built-in teas, validates it against the bundled contract, and preserves the previous knowledge base as `knowledgeBaseBackup`. The settings page restores that backup through `PATCH /api/state/knowledgeBase`. These operations do not replace tea history or personal overrides.

The JSON export and SQLite snapshot are not full disaster-recovery backups: they omit upload bytes, and the snapshot does not include the encryption environment file. The scheduled complete backup and old mini-program migration are step 6.

## Inventory lifecycle helper

The JSON section write preserves the existing full-snapshot storage model. `server.state.inventory_operation(records, operation, item_id, now=None)` is the pure, reusable lifecycle operation used by server callers and tests. It mirrors `utils/data.js`: opening a quantity-two sealed aggregate leaves one sealed unit and creates one opened unit, consumption decrements sessions and marks the last one finished with zero remaining amount, and deletion retains a `deletedAt` tombstone. It rejects invalid transitions. Every inventory snapshot is checked for contract fields, valid status/package type, quantity rules, and finished-state remaining amounts.

## Version migration and persistence

On startup, the database keeps the existing `app_state` row and revision, migrates the first-slice/version 1 shape to version 2, and only inserts defaults when the row is absent. User data is not reseeded on restart. Updates run under `BEGIN IMMEDIATE`, compare `baseRevision`, validate the complete candidate, and write the payload and revision together. Failed writes roll back. Session and processed mutation IDs are kept in separate small tables.

Run backend checks with:

```powershell
python -m unittest server.tests.test_app -v
```
