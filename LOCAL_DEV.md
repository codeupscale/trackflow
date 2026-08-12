# Local Development — Run & Credentials

> Local-only demo credentials and run steps. These are **seeded demo data**, not production
> secrets. Safe to keep in the repo. Do NOT reuse these values in staging/production.

## Login credentials (web dashboard + desktop app)

Seeded by `php artisan db:seed`. Password is **`password`** for all accounts.
One account per system role in the RBAC matrix:

| Role            | Email               | `users.role`      | Password   |
| --------------- | ------------------- | ----------------- | ---------- |
| Super Admin     | `owner@acme.com`    | `owner`           | `password` |
| Manager         | `manager@acme.com`  | `org_manager`     | `password` |
| HR              | `hr@acme.com`       | `hr_manager`      | `password` |
| Finance Manager | `finance@acme.com`  | `finance_manager` | `password` |
| Employee        | `alice@acme.com`    | `employee`        | `password` |

Three more employees exist for team/project data: `bob@acme.com`, `carol@acme.com`,
`dave@acme.com`.

> `admin@acme.com` is **gone**. The `admin` and `manager` role names were retired by
> migration `2026_05_13_000004`; an account carrying either one matches no system role and
> resolves an **empty permission map** — it signs in and then sees an empty dashboard.
> If your DB was seeded before this change, re-run `php artisan db:seed` to repair it.

> Production/staging accounts (e.g. `*@codeupscale.com`) do **not** exist in a fresh local DB.

## Database (Docker Postgres)

The Docker Postgres container is initialized from the **root `.env`**, so `backend/.env` MUST match:

| Setting     | Value                |
| ----------- | -------------------- |
| User        | `postgres`           |
| Password    | `password`           |
| Database    | `trackflow`          |
| Host / Port | `127.0.0.1` : `5433` |
| Redis       | `127.0.0.1` : `6380` |

⚠️ If `backend/.env` and the root `.env` disagree on `DB_USERNAME` / `DB_PASSWORD`, every query
returns HTTP 500 and the desktop app shows **"Server is not responding."** Keep them aligned.
After `docker compose down -v` (wipes the volume), Postgres re-inits from the root `.env`.

## Two ways to run this

`compose.yaml` supports both. Pick one — they use the same ports, so they cannot run
at the same time (the port collision tells you immediately instead of failing quietly).

| | **Mode A — infra in Docker** | **Mode B — everything in Docker** |
| --- | --- | --- |
| Command | `docker compose up -d` | `docker compose --profile app up -d` |
| In Docker | Postgres, Redis, Mailpit, MinIO | …plus API, Horizon, scheduler, Reverb, web, marketing |
| On your machine | backend, web, marketing | nothing but the desktop agent |
| Best for | debugging PHP natively, fastest edit loop | matching CI, onboarding, "it works on my machine" |

Both modes read the **same `backend/.env`**. You never edit it to switch. `compose.yaml`
overrides `DB_HOST`/`REDIS_HOST`/`MAIL_HOST` for the containers only — Laravel loads
`.env` through an immutable repository, so a real environment variable always wins over
the file. Next.js works the same way with `.env.local`.

The **Electron desktop agent always runs natively** in both modes — it is a GUI app and
cannot be containerised. It talks to whichever API is up.

### Mode B — everything in Docker

Order matters on a fresh clone. `backend/` is bind-mounted, so the host's empty
`vendor/` shadows the one in the image — start the app container first and it will
crash-loop before you can install anything. Bring up infra, install, then start the app:

```bash
docker compose up -d                                          # 1. infra only
docker compose run --rm laravel.test composer install         # 2. builds image (~3-5 min), fills vendor/
docker compose run --rm laravel.test php artisan migrate --seed   # 3. schema + demo data
docker compose --profile app up -d                            # 4. everything
docker compose --profile app logs -f                          # watch it come up
```

Steps 2 and 3 are first-run only. After that, step 4 alone is enough.

Then: web on <http://localhost:3000>, marketing on <http://localhost:3001>,
API on <http://localhost:8000>, MinIO console on <http://localhost:9001>.

`npm ci` runs inside the web/marketing containers only when their `node_modules` volume
is empty, so restarts are fast. Force a reinstall with
`docker compose down -v web marketing` (this also drops their `.next` cache).

To stop: `docker compose --profile app down` (add `-v` to wipe DB/Redis/MinIO volumes).

### Mode A — infra only (4 terminals)

All three apps must use the **same API port** (we use **8000** locally).

**1. Infra (Docker):**

```bash
docker compose up -d
```

**2. Backend (Laravel) — port 8000:**

On a new machine, create `backend/.env` from the **local** template — there are three
`.env.example` files in this repo and only one of them is right for native PHP:

```bash
cd backend
cp .env.local.example .env
php artisan key:generate
```

| Template | For | Do not use it locally because |
| --- | --- | --- |
| `backend/.env.local.example` | **native PHP + Docker infra — use this** | — |
| `.env.example` (repo root) | Docker / Sail, inside the container | `DB_HOST=pgsql`, `REDIS_HOST=redis`, `DB_USERNAME=sail` — none of those hosts resolve from your machine, and `REDIS_CLIENT=phpredis` needs a C extension a stock PHP doesn't have |
| `backend/.env.example` | CI / PHPUnit | `APP_ENV=testing` on sqlite `:memory:` — no real database at all |

Then start the server:

```bash
php artisan serve --host=127.0.0.1 --port=8000
```

First-time setup (empty DB): `php artisan migrate --seed`

If HR nav looks incomplete after an older seed (missing Employees, Leave, Reports), or the
demo accounts are missing/on a retired role, re-run the full seeder — it is idempotent and
repairs users, roles and role assignments without duplicating the sample time entries:

```bash
cd backend
php artisan db:seed
```

Prefer that over `db:seed --class=PermissionSeeder`. Running `PermissionSeeder` **alone**
deletes and recreates each org's system roles, and `user_roles.role_id` is
`ON DELETE CASCADE` — so it silently drops every role assignment. `DatabaseSeeder` re-creates
them; `PermissionSeeder` on its own does not.

Then **log out and log back in** on the web app (clears cached permissions in localStorage).
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

## File storage (MinIO)

`minio` is part of the infra set, so it starts in both modes. Console:
<http://localhost:9001> — user `trackflow`, password `trackflow-local` (override with
`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` in the root `.env`). The
`trackflow-local` bucket is created automatically on startup by `minio-init`.

**Mode B points at MinIO automatically.** Mode A does not — a natively-run backend reads
`backend/.env`, which ships `FILESYSTEM_DISK=s3` and the real AWS keys, so screenshot
uploads go to the live `codeupscale-trackflow-media` bucket. To keep local data local,
add this to `backend/.env`:

```dotenv
AWS_ACCESS_KEY_ID=trackflow
AWS_SECRET_ACCESS_KEY=trackflow-local
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=trackflow-local
AWS_ENDPOINT=http://127.0.0.1:9000
AWS_URL=http://127.0.0.1:9000/trackflow-local
AWS_USE_PATH_STYLE_ENDPOINT=true
```

Then `php artisan config:clear`.

## Quick health check

```bash
# DB connection + table count
cd backend && php artisan db:show

# Login works end-to-end
curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"email":"owner@acme.com","password":"password"}'
```

## Common gotcha → cause

| Symptom                                           | Cause                                                                                                                                                                                    | Fix                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Desktop: "Server is not responding"               | Backend 500 (DB auth fail) or wrong port                                                                                                                                                 | Check `backend/.env` DB creds match root `.env`; `config:clear`                   |
| Login: "role admin does not exist"                | `backend/.env` user ≠ container user                                                                                                                                                     | Set `DB_USERNAME=postgres`, `DB_PASSWORD=password`                                |
| Web can't reach API                               | `NEXT_PUBLIC_API_URL` port mismatch                                                                                                                                                      | Point to `:8000`, restart `npm run dev`                                           |
| Web login "network error" (but API works in curl) | CSP `connect-src` in `web/next.config.ts` only allows the API on `:8000` (8080/8081 are reserved for the Reverb WebSocket). Running the API on any other port is blocked by the browser. | Keep the API on `:8000`. Don't run the backend on 8080 — it collides with Reverb. |
| `WARN Table [users] doesn't exist`                | DB not migrated                                                                                                                                                                          | `php artisan migrate --seed`                                                      |
| "Please make sure the PHP Redis extension is installed and enabled" | `REDIS_CLIENT` is unset or `phpredis` — that's a C extension a stock native PHP doesn't have. Usually means `backend/.env` was copied from the ROOT `.env.example` (the Docker one). | Set `REDIS_CLIENT=predis` in `backend/.env`, then `php artisan config:clear`. `predis/predis` is already a composer dependency — nothing to install. |
| Signed in but the dashboard is empty (no nav, no pages) | The account's `users.role` matches no system role — e.g. the retired `admin`/`manager` names                                                                                        | `php artisan db:seed` to repair, then log out and back in                          |
| Electron native module error                      | better-sqlite3/sharp not rebuilt                                                                                                                                                         | `cd desktop && npm run postinstall`                                               |
| **Mode B:** API container restarts forever, logs show `vendor/autoload.php` not found | `backend/` is bind-mounted, so the image's vendor dir is shadowed by the host's — which is empty until you install                                              | `docker compose run --rm laravel.test composer install`                           |
| **Mode B:** `bind: address already in use` on 8000/3000/3001 | Mode A is still running natively (`artisan serve` / `npm run dev`), or the other mode's containers are up                                                        | Stop the native processes, or `docker compose down`. The two modes share ports by design. |
| **Mode B:** web loads but every API call fails    | Something set `NEXT_PUBLIC_API_URL` to a container name. It is read by the **browser**, which runs on your host and cannot resolve `laravel.test`.                                        | It must stay `http://localhost:8000/api/v1`. `compose.yaml` sets this already.     |
| **Mode A:** uploads land in the real S3 bucket    | `backend/.env` has `FILESYSTEM_DISK=s3` with the live AWS keys from the root `.env`. Mode B redirects to MinIO; native mode does not.                                                     | Point `backend/.env` at MinIO — see *File storage* below.                          |
