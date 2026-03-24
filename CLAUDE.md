# TrackFlow — Project Instructions for Claude

## Project Overview
TrackFlow is a workforce time tracking & monitoring platform (like Hubstaff). It consists of three codebases in a monorepo:

| Component | Tech | Path |
|---|---|---|
| Backend API | Laravel 12, PHP 8.2+, PostgreSQL 18, Redis | `/backend` |
| Web Frontend | Next.js 16, React 19, TypeScript, Zustand, TanStack Query | `/web` |
| Desktop Agent | Electron 28, Node.js, better-sqlite3 | `/desktop` |

## Architecture

```
Desktop Agent ──► Laravel REST API (v1) ──► PostgreSQL + Redis + S3
Web Dashboard ──►        ▲
                         │
                    Reverb WebSocket (real-time)
```

## Key Conventions

### Backend (Laravel)
- **Multi-tenant**: All queries scoped by `organization_id` via `GlobalOrganizationScope`
- **Auth**: Laravel Sanctum with access + refresh tokens (24h / 30d)
- **Roles**: owner > admin > manager > employee (4-tier)
- **Services**: Business logic in `app/Services/`, controllers stay thin
- **Jobs**: All background work in `app/Jobs/` with retry logic and timeouts
- **Routes**: All API routes in `routes/api.php` under `/api/v1/`
- **UUIDs**: All models use UUIDs as primary keys
- **Pagination**: All list endpoints MUST use `->paginate()`, never `->get()` for collections

### Frontend (Next.js)
- **App Router**: Pages in `src/app/(dashboard)/` with layout groups
- **State**: Zustand stores in `src/stores/` (auth-store, timer-store)
- **Data fetching**: TanStack Query (`useQuery`/`useMutation`) — never raw `useEffect` for API calls
- **UI**: shadcn/ui components in `src/components/ui/`, Tailwind CSS
- **API client**: `src/lib/api.ts` with token refresh mutex (handles concurrent 401s)
- **Role-based**: Check `user?.role` for conditional rendering, early return with loading spinner for unauthorized pages

### Desktop (Electron)
- **Security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on ALL windows
- **IPC**: All renderer ↔ main communication through preload bridge (`src/preload/index.js`)
- **Services**: Modular services in `src/main/` (screenshot-service, activity-monitor, idle-detector, offline-queue, keychain, api-client)
- **Tokens**: AES-256-GCM encrypted file (NOT keytar/safeStorage — both cause macOS keychain popups)
- **Screenshots**: Window capture first on macOS (avoids wallpaper-only bug with ad-hoc signing), screen capture on Windows/Linux
- **Build**: electron-builder, ad-hoc signing with entitlements, auto-update via GitHub Releases

## Database
- PostgreSQL 18 with 20+ tables
- Key tables: `organizations`, `users`, `time_entries`, `screenshots`, `activity_logs`, `timesheets`
- All foreign keys indexed, composite indexes on frequently queried columns
- Migrations in `backend/database/migrations/`

## Testing
- Backend: `php artisan test` (PHPUnit)
- Desktop: `npx jest` in `/desktop`
- Web: `npm test` in `/web` (if configured)
- CI: `.github/workflows/tests.yml` runs backend tests + security audits

## Deployment
- Docker Compose for dev (`compose.yaml`) and production (`compose.production.yaml`)
- Desktop releases via GitHub Releases with auto-update
- Build: `npm run build:mac`, `npm run build:win`, `npm run build:linux`

## Security Rules
- NEVER use `->get()` without pagination on list endpoints
- NEVER expose user passwords, tokens, or API keys in responses
- ALWAYS validate `organization_id` scope on data access
- ALWAYS use parameterized queries (Eloquent), never raw SQL with user input
- CORS restricted to explicit headers and origins
- CSP headers on both web frontend and Electron renderer
- Rate limiting on all auth and agent endpoints
