# PostHog Integration Plan — TrackFlow

## Overview
Integrate PostHog across the **Web Dashboard** (Next.js) and **Desktop Agent** (Electron) for:
- Error tracking (JS exceptions, API failures, unhandled rejections)
- Product analytics (page views, feature usage, user flows)
- User identification (tie events to user + organization)
- Session replay (web only — watch user sessions to diagnose bugs)

## Architecture

```
Web Dashboard (posthog-js)          Desktop Agent (posthog-node)
  ├─ PostHogProvider (React)          ├─ PostHogService (singleton)
  ├─ Auto page views                  ├─ Timer start/stop events
  ├─ Error boundary capture           ├─ Error/crash capture
  ├─ API error capture                ├─ Heartbeat failures
  ├─ User identify on auth            ├─ User identify on login
  └─ Session replay                   └─ Offline queue flush events
         │                                    │
         └───────── PostHog Cloud ────────────┘
                  (us.i.posthog.com)
```

## Agent Assignments (5 parallel agents)

### Agent 1: Frontend Engineer — PostHog Provider & Core Setup
**Files to create/modify:**
- `web/src/lib/posthog.ts` — PostHog client singleton + helpers
- `web/src/components/posthog-provider.tsx` — React provider with auto page view tracking
- `web/src/components/providers.tsx` — Wire PostHogProvider into existing provider tree
- `web/src/app/layout.tsx` — Add `<Script>` tag for PostHog snippet (optional, provider handles it)

**What it does:**
1. Create `web/src/lib/posthog.ts`:
   - Initialize `posthog-js` with `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`
   - SSR-safe: guard with `typeof window !== 'undefined'`
   - Export singleton + typed helper functions: `captureError()`, `identifyUser()`, `resetUser()`
   - Session replay enabled, autocapture enabled, capture_pageview disabled (manual via router)
2. Create `web/src/components/posthog-provider.tsx`:
   - PostHogProvider wrapping `posthog-js/react`
   - `usePathname()` + `useSearchParams()` to fire `$pageview` on route change
   - Suspense boundary for `useSearchParams()`
3. Modify `web/src/components/providers.tsx`:
   - Import and wrap children with `<PHProvider>`

### Agent 2: Frontend Engineer — Error Tracking & API Integration
**Files to modify:**
- `web/src/components/error-boundary.tsx` — Capture React errors to PostHog
- `web/src/app/global-error.tsx` — Capture root-level errors to PostHog
- `web/src/lib/api.ts` — Capture API errors (4xx/5xx) to PostHog
- `web/src/stores/auth-store.ts` — `posthog.identify()` on login/register, `posthog.reset()` on logout

**What it does:**
1. `error-boundary.tsx`: In `componentDidCatch`, call `captureError(error, { componentStack })` from posthog lib
2. `global-error.tsx`: In component body, call `captureError(error)` via useEffect
3. `api.ts`: In the response error interceptor, capture 5xx errors and network failures to PostHog (skip 401/403 as those are auth flow, not bugs)
4. `auth-store.ts`: After successful login/register, call `identifyUser(user)` with user id, email, name, role, org. On logout, call `resetUser()`.

### Agent 3: DevOps Engineer — Config, CSP, Environment, Docker
**Files to modify:**
- `web/.env.local` — Add PostHog env vars
- `web/.env.example` (create if missing) — Document PostHog env vars
- `web/next.config.ts` — Update CSP to allow PostHog domains
- `web/Dockerfile.production` — Add PostHog build args

**What it does:**
1. Add to `.env.local`:
   ```
   NEXT_PUBLIC_POSTHOG_KEY=phc_your_project_key_here
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```
2. Update CSP in `next.config.ts`:
   - `script-src`: add `https://us.i.posthog.com`
   - `connect-src`: add `https://us.i.posthog.com https://us.posthog.com`
   - `img-src`: add `https://us.i.posthog.com` (for session replay assets)
3. Update `Dockerfile.production`: add `ARG NEXT_PUBLIC_POSTHOG_KEY` and `ARG NEXT_PUBLIC_POSTHOG_HOST`

### Agent 4: Desktop Engineer — PostHog Service for Electron
**Files to create/modify:**
- `desktop/src/main/posthog.js` — PostHog Node.js service (singleton)
- `desktop/.env` — Add PostHog env vars

**What it does:**
1. Create `desktop/src/main/posthog.js`:
   - Uses `posthog-node` (server-side SDK)
   - Singleton pattern matching existing service style (ActivityMonitor, OfflineQueue, etc.)
   - Methods: `init(apiKey, options)`, `identify(userId, properties)`, `capture(event, properties)`, `captureError(error, context)`, `shutdown()`
   - Graceful degradation: if PostHog key is missing, all methods are no-ops (no crashes)
   - Flush on app quit
   - Include app version, platform, arch in every event as `$set` properties
2. Add to `desktop/.env`:
   ```
   POSTHOG_KEY=phc_your_project_key_here
   POSTHOG_HOST=https://us.i.posthog.com
   ```

### Agent 5: Desktop Engineer — PostHog Integration into Main Process
**Files to modify:**
- `desktop/src/main/index.js` — Wire PostHog into all critical paths

**What it does:**
1. Import and initialize PostHog service in `initializeApp()` (after token validation, before service start)
2. `identify()` user after successful `apiClient.getMe()` with userId, email, name, role, org
3. Capture key lifecycle events:
   - `timer_started` / `timer_stopped` (with project_id)
   - `app_launched` / `app_quit`
   - `screenshot_captured` / `screenshot_failed`
   - `heartbeat_failed` (with error reason)
   - `offline_queue_flushed` (with count)
   - `idle_detected` / `idle_resolved` (with action taken)
   - `auto_update_available` / `auto_update_downloaded`
4. Wire into global error handlers:
   - `uncaughtException` → `posthog.captureError(error)`
   - `unhandledRejection` → `posthog.captureError(reason)`
5. Call `posthog.shutdown()` in `before-quit` handler
6. Reset on logout

## Packages to Install
| Package | Where | Version |
|---|---|---|
| `posthog-js` | `web/` | latest |
| `posthog-node` | `desktop/` | latest |

## Key Design Decisions
1. **posthog-js for web** (not posthog-node) — runs client-side, captures session replay, auto-captures DOM events
2. **posthog-node for desktop** (not posthog-js) — Electron main process is Node.js, no browser APIs
3. **Graceful degradation** — if `POSTHOG_KEY` is empty/missing, all PostHog calls become no-ops. App never crashes due to analytics.
4. **No PII in events** — capture user ID, email, role, org name. Never capture passwords, tokens, or screenshot content.
5. **Manual page views** — disable PostHog auto page view (doesn't work with Next.js App Router), use `usePathname()` instead.
6. **Skip 401/403 in API error capture** — these are normal auth flow, not bugs. Only capture 5xx and network errors.
