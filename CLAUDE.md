# TrackFlow — Engineering Standards & Project Context

## What This Is
TrackFlow is a production workforce time tracking & monitoring platform (comparable to Hubstaff). Monorepo with three codebases:

| Component | Stack | Path | Runtime |
|---|---|---|---|
| Backend API | Laravel 12, PHP 8.2+, PostgreSQL 18, Redis 7 | `/backend` | Docker / Sail |
| Web Dashboard | Next.js 16, React 19, TypeScript 5.x, Zustand, TanStack Query v5 | `/web` | Node 20+ |
| Desktop Agent | Electron 28, Node.js, better-sqlite3, sharp | `/desktop` | Native binary |

## System Architecture
```
                    ┌──────────────────────────────────┐
                    │        PostgreSQL 18              │
                    │   (multi-tenant, UUID PKs,        │
                    │    org_id scoping on all tables)   │
                    └──────────┬───────────────────────┘
                               │
Desktop Agent ──► Laravel REST API v1 ──► Redis (cache + queue)
  (Electron)       │    │    │              │
                   │    │    │         Horizon (workers)
Web Dashboard ─────┘    │    │
  (Next.js SSR)         │    └──► S3 / CloudFront (screenshots)
                        │
                   Reverb WebSocket (real-time updates)
```

## Non-Negotiable Engineering Rules

### 1. Data Isolation (Multi-Tenancy)
Every database query MUST be scoped by `organization_id`. The `GlobalOrganizationScope` trait handles this for Eloquent models. For raw/aggregate queries, add explicit `WHERE organization_id = ?`. A query that leaks data across orgs is a P0 security incident.

### 2. API Design
- All list endpoints: `->paginate()`, NEVER `->get()` for unbounded collections
- Response envelope: `{ "data": [...], "meta": { "current_page", "last_page", "total" } }`
- Errors: `{ "message": "Human-readable", "errors": { "field": ["..."] } }` (Laravel default)
- Auth: Bearer token via Sanctum. Access token (24h) + refresh token (30d)
- Versioning: All routes under `/api/v1/`
- Rate limits defined in `AppServiceProvider`: auth=10/min, general=1000/min

### 3. Code Organization
- **Controllers**: Thin. Validate input, call service, return response. Max ~30 lines per method.
- **Services**: `app/Services/` — all business logic. Constructor injection via Laravel DI.
- **Jobs**: Background work. Every job MUST have `$tries`, `$timeout`, `$backoff`, and `failed()` handler.
- **Policies**: Authorization logic. Every controller action that accesses a resource must `$this->authorize()`.
- **Models**: Eloquent with `$fillable`, UUID traits, relationship definitions. No business logic in models.

### 4. Frontend Patterns
- Data fetching: TanStack Query (`useQuery`/`useMutation`). Never raw `useEffect + fetch`.
- State: Zustand stores. Cleanup intervals on unmount and logout. No stale subscriptions.
- SSR safety: `typeof window !== 'undefined'` guard on all browser-only APIs.
- Error handling: Every query destructures `isLoading`, `isError` and renders both states.
- Role-based: Early return with `<PageLoading />` for unauthorized roles. No content flash.

### 5. Desktop Security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on ALL BrowserWindows
- ALL renderer ↔ main communication through `contextBridge` in preload script
- Token storage: AES-256-GCM via Node.js `crypto`. NOT keytar, NOT safeStorage (both trigger macOS keychain popups on ad-hoc signed apps)
- Screenshots on macOS: window capture first (avoids wallpaper-only bug), screen capture fallback

### 6. Performance Budgets
| Metric | Target | Measured By |
|---|---|---|
| API response (p95) | < 200ms | Laravel Telescope / logs |
| Dashboard first paint | < 2s | Lighthouse |
| Desktop memory (idle) | < 150MB | Activity Monitor |
| Desktop memory (tracking) | < 250MB | Activity Monitor |
| Screenshot capture | < 3s | `[SS]` log timestamps |
| Time entry query (1M rows) | < 500ms | EXPLAIN ANALYZE |

### 7. Git & Release
- Branch: `fix/web-frontend-and-desktop-app` (current), merge to `main`
- Commits: conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`)
- Desktop releases: GitHub Releases with `latest-mac.yml` / `latest.yml` manifests
- CI: `.github/workflows/tests.yml` — PHPUnit + `composer audit` + `npm audit`

## Quick Reference — Key Files

| What | Where |
|---|---|
| API routes | `backend/routes/api.php` |
| Controllers | `backend/app/Http/Controllers/Api/V1/` |
| Services | `backend/app/Services/` (Timer, Report, Billing, Audit, Permission) |
| Models | `backend/app/Models/` |
| Migrations | `backend/database/migrations/` |
| Frontend pages | `web/src/app/(dashboard)/*/page.tsx` |
| API client | `web/src/lib/api.ts` (axios + token refresh mutex) |
| Zustand stores | `web/src/stores/` (auth-store, timer-store) |
| Desktop main | `desktop/src/main/index.js` |
| Desktop services | `desktop/src/main/` (screenshot, activity, idle, offline, keychain) |
| Build config | `desktop/package.json` (build field) |
| Docker dev | `compose.yaml` |
| Docker prod | `compose.production.yaml` |
