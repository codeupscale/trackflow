# Local Development — Run & Credentials

> Local-only demo credentials and run steps. These are **seeded demo data**, not production
> secrets. Safe to keep in the repo. Do NOT reuse these values in staging/production.

## Login credentials (web dashboard + desktop app)

Seeded by `php artisan db:seed`. Password is **`password`** for all accounts.

| Role | Email | Password |
|------|-------|----------|
| Owner | `owner@acme.com` | `password` |
| Admin | `admin@acme.com` | `password` |
| Manager | `manager@acme.com` | `password` |
| Employee | `alice@acme.com` | `password` |

> Production/staging accounts (e.g. `*@codeupscale.com`) do **not** exist in a fresh local DB.

## Database (Docker Postgres)

The Docker Postgres container is initialized from the **root `.env`**, so `backend/.env` MUST match:

| Setting | Value |
|---------|-------|
| User | `postgres` |
| Password | `password` |
| Database | `trackflow` |
| Host / Port | `127.0.0.1` : `5433` |
| Redis | `127.0.0.1` : `6380` |

⚠️ If `backend/.env` and the root `.env` disagree on `DB_USERNAME` / `DB_PASSWORD`, every query
returns HTTP 500 and the desktop app shows **"Server is not responding."** Keep them aligned.
After `docker compose down -v` (wipes the volume), Postgres re-inits from the root `.env`.

## Run steps (4 terminals)

All three apps must use the **same API port** (we use **8000** locally).

**1. Infra (Docker):**
```bash
docker compose up -d pgsql redis minio mailpit
```

**2. Backend (Laravel) — port 8000:**
```bash
cd backend
php artisan serve --host=127.0.0.1 --port=8000
```
First-time setup (empty DB): `php artisan migrate --seed`
After editing `.env`: `php artisan config:clear`

**3. Web dashboard (Next.js):**
```bash
cd web
npm run dev
```
API URL in `web/.env.local`: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api/v1`
(restart `npm run dev` after changing `NEXT_PUBLIC_*`)

**4. Desktop agent (Electron):**
```bash
cd desktop
npm install        # first time — rebuilds better-sqlite3 / sharp via postinstall
npm run dev        # or: npm run dev:inspect (DevTools on :9222)
```
API URL in `desktop/.env`: `TRACKFLOW_API_URL=http://127.0.0.1:8000/api/v1`
(use `127.0.0.1`, NOT `localhost` — `localhost` resolves to IPv6 `::1` first, but
`artisan serve --host=127.0.0.1` only listens on IPv4 → "Server is not responding".
Restart the Electron app after changing `.env`.)

**Optional — background jobs (timer/screenshot processing):**
```bash
cd backend
php artisan horizon     # or: php artisan queue:work
```

## Quick health check

```bash
# DB connection + table count
cd backend && php artisan db:show

# Login works end-to-end
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"email":"admin@acme.com","password":"password"}'
```

## Common gotcha → cause

| Symptom | Cause | Fix |
|---------|-------|-----|
| Desktop: "Server is not responding" | Backend 500 (DB auth fail) or wrong port | Check `backend/.env` DB creds match root `.env`; `config:clear` |
| Login: "role admin does not exist" | `backend/.env` user ≠ container user | Set `DB_USERNAME=postgres`, `DB_PASSWORD=password` |
| Web can't reach API | `NEXT_PUBLIC_API_URL` port mismatch | Point to `:8000`, restart `npm run dev` |
| Web login "network error" (but API works in curl) | CSP `connect-src` in `web/next.config.ts` only allows the API on `:8000` (8080/8081 are reserved for the Reverb WebSocket). Running the API on any other port is blocked by the browser. | Keep the API on `:8000`. Don't run the backend on 8080 — it collides with Reverb. |
| `WARN Table [users] doesn't exist` | DB not migrated | `php artisan migrate --seed` |
| Electron native module error | better-sqlite3/sharp not rebuilt | `cd desktop && npm run postinstall` |
