# PWA server data API

The server is a single-user FastAPI application backed by one SQLite database. It stores one versioned JSON state row; it does not split each business field into a table. The built-in tea list and knowledge catalog come from `seed.json` and remain the defaults on first run.

## Configuration

Copy `.env.example` to `.env`. Set `APP_PASSWORD_HASH`, `APP_ENCRYPTION_KEY`, and `DATA_DIR`. Generate the password hash with `python -m server.create_password_hash`. Generate the encryption key with:

```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep both values private and back them up with the SQLite file. Losing `APP_ENCRYPTION_KEY` makes the separately encrypted AI key unreadable. No provider key belongs in this repository or `.env.example`.

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

In a second terminal, start the frontend with `cd web`, `npm ci`, and `npm run dev`, then open `http://127.0.0.1:5173/`. The UI is still a read-only tea list; the new write endpoints are for the later editing screens.

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

## Inventory lifecycle helper

The JSON section write preserves the existing full-snapshot storage model. `server.state.inventory_operation(records, operation, item_id, now=None)` is the pure, reusable lifecycle operation used by server callers and tests. It mirrors `utils/data.js`: opening a quantity-two sealed aggregate leaves one sealed unit and creates one opened unit, consumption decrements sessions and marks the last one finished with zero remaining amount, and deletion retains a `deletedAt` tombstone. It rejects invalid transitions. Every inventory snapshot is checked for contract fields, valid status/package type, quantity rules, and finished-state remaining amounts.

## Version migration and persistence

On startup, the database keeps the existing `app_state` row and revision, migrates the first-slice/version 1 shape to version 2, and only inserts defaults when the row is absent. User data is not reseeded on restart. Updates run under `BEGIN IMMEDIATE`, compare `baseRevision`, validate the complete candidate, and write the payload and revision together. Failed writes roll back. Session and processed mutation IDs are kept in separate small tables.

Run backend checks with:

```powershell
python -m unittest server.tests.test_app -v
```
