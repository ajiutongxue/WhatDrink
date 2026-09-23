# PWA server

From the repository root, install Python dependencies and create a local environment file:

```powershell
python -m pip install -r server/requirements-dev.txt
Copy-Item server/.env.example server/.env
python -m server.create_password_hash
```

Paste the generated hash into `server/.env` as `APP_PASSWORD_HASH`. Keep `.env` private. The example uses an HTTP-only development cookie; production must use HTTPS with `APP_ENV=production` and `COOKIE_SECURE=true`.

Start the API from the repository root:

```powershell
python -m uvicorn server.app:app --reload --port 8000
```

In a second terminal, start the web page:

```powershell
Set-Location web
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/` and log in with the password used to create the hash. The Vite development server proxies `/api` to port 8000. This first slice is a read-only tea list, not yet an installable/offline PWA.

The database is created at `server/runtime/tea.sqlite3`. Set `DATA_DIR` to move it. The first run inserts the seed only when state is absent; subsequent starts retain the database state.

Run the authentication, seed, and restart checks from the repository root with `python -m unittest server.tests.test_app`.

Regenerate or check the canonical seed after changing its source data:

```powershell
node scripts/generate-pwa-seed.js
node scripts/generate-pwa-seed.js --check
```
