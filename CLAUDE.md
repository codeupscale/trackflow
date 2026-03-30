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
- Layout: shadcn Sidebar primitive (`web/src/components/ui/sidebar.tsx`) with collapsible icon mode; mobile uses Sheet overlay.
- Charts: shadcn `ChartContainer` (`web/src/components/ui/chart.tsx`) wrapping Recharts primitives. Never use raw `ResponsiveContainer` — always wrap in `<ChartContainer config={...}>`. Use `ChartTooltip`/`ChartTooltipContent` and `ChartLegend`/`ChartLegendContent` from the chart component. Colors use CSS variables `--chart-1` through `--chart-5` via `hsl(var(--chart-N))` in `ChartConfig`.
- Dashboard layout: shadcn dashboard-01 design. Sidebar has 3 nav groups (Main / Analytics / Team) with role-based filtering. Area charts with gradient fills for both admin (hours + activity) and employee (hours) views.

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

## Multi-Organization Authentication

Users can belong to multiple organizations (same email, different `organization_id` in `users` table). The auth system handles this:

### Login Flow (email/password & Google OAuth)
1. Backend finds ALL User rows matching the email/Google ID
2. If single org: direct login (original behavior)
3. If multiple orgs: returns `{ "requires_org_selection": true, "organizations": [...] }`
4. Client shows org selector, user picks one
5. Client calls `POST /auth/select-organization` with credentials + `organization_id`

### API Endpoints
| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /auth/select-organization` | Public | Complete login after multi-org detection |
| `GET /auth/organizations` | Sanctum | List all orgs for the current user's email |
| `POST /auth/switch-organization` | Sanctum | Switch to different org (issues new tokens) |

### Frontend Components
| Component | Path | Purpose |
|---|---|---|
| OrgSelector | `web/src/components/org-selector.tsx` | Login-time org picker (Card UI) |
| OrgSwitcher | `web/src/components/org-switcher.tsx` | Dashboard header dropdown to switch orgs |
| Sidebar | `web/src/components/ui/sidebar.tsx` | shadcn Sidebar primitive (collapsible, mobile sheet, keyboard shortcut Cmd+B) |

### Desktop Google OAuth
- Uses OAuth Authorization Code flow via system browser
- Starts temporary local HTTP server on `127.0.0.1` for the callback
- Exchanges auth code for ID token, sends to `POST /auth/google`
- Requires `TRACKFLOW_GOOGLE_CLIENT_ID` and `TRACKFLOW_GOOGLE_CLIENT_SECRET` env vars

### Invitation-Aware Google Signup
- When a new Google user signs up, the backend checks for pending invitations
- Pending invitations are auto-accepted: user is added to those orgs with the invited role
- A personal org is also created so the user always has at least one

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
| Org selector | `web/src/components/org-selector.tsx` |
| Org switcher | `web/src/components/org-switcher.tsx` |
| Sidebar primitive | `web/src/components/ui/sidebar.tsx` (shadcn Sidebar with collapsible icon mode) |
| Chart primitive | `web/src/components/ui/chart.tsx` (shadcn ChartContainer, ChartTooltip, ChartLegend) |
| Desktop main | `desktop/src/main/index.js` |
| Desktop services | `desktop/src/main/` (screenshot, activity, idle, offline, keychain) |
| Build config | `desktop/package.json` (build field) |
| Docker dev | `compose.yaml` |
| Docker prod | `compose.production.yaml` |
