# Screenshots don't appear in web in real time (missing broadcast + missing subscription)

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #2 (P1). Backend broadcast + web subscription.

**Scope:** Backend screenshot ingest broadcast (`backend/app/Jobs/ProcessScreenshotJob.php`, `backend/app/Events/ScreenshotUploaded.php`, `backend/app/Support/ScreenshotUrl.php`) and web realtime subscription (`web/src/hooks/use-screenshot-realtime.ts`, `web/src/app/(dashboard)/screenshots/page.tsx`).

**Severity:** P1 — new screenshots only appear after a browser refresh, making live monitoring look broken.

## Symptom

QA (Employee role): screenshots do not appear in the web screenshots section in real time; they only show up after a manual browser refresh.

## Root cause

Two gaps, one on each side:

1. **Backend never broadcast.** The `ScreenshotUploaded` event class existed but was **never dispatched anywhere** — no Reverb broadcast fired on screenshot ingest. It was also declared queued `ShouldBroadcast` with a thin 3-field payload.
2. **Web never subscribed.** The screenshots page relied solely on TanStack Query `staleTime`/`refetchInterval` (60/90 min) plus window-focus refetch. There was no `.listen('ScreenshotUploaded')` subscription, so nothing updated the list live.

## Fix

**Backend:**
- `ProcessScreenshotJob::handle()` now dispatches `ScreenshotUploaded` at the **end**, after the row + thumbnail keys + `processed_at` are persisted (`->refresh()` then dispatch), so the broadcast only fires when the thumbnail is renderable.
- Event converted to `ShouldBroadcastNow` (mirroring `TimerStarted`) with a full list-row payload.
- Channel authorization already org-scoped in `routes/channels.php` (`org.{orgId}` → `private-org.{organization_id}`); no cross-org leakage. Signed temporary URLs via new `App\Support\ScreenshotUrl` — no raw S3 `file_path` exposed.

**Contract** (mirrors the working `TimerStarted` convention):
- Channel: `echo.private(\`org.${orgId}\`)` (Reverb `private-org.{organization_id}`)
- Event: `.listen('ScreenshotUploaded', (e) => …)` — no leading dot, no `broadcastAs`
- Payload: **minimal, non-sensitive** `{ screenshot_id, user_id }` (see Security note below).

### Security hardening (A01 — Broken Access Control)

The initial implementation broadcast a full screenshot row (signed `thumbnail_url`/`url`, `window_title`, `app_name`, activity metrics) on the **org-wide** `org.{id}` channel. That channel authorizes on org membership only — every role, including employees, subscribes — so an employee would have received coworkers' signed screenshot URLs (capability URLs: possession = access) and window/app metadata directly in the WebSocket frame, even though the UI hid them. Client-side filtering is **not** an access-control boundary (found in the Phase 5 security scan of this batch).

Fix: the broadcast payload was reduced to exactly `{ screenshot_id, user_id }` — a "something changed" ping carrying only non-sensitive routing identifiers. `user_id` lets the client apply its role-scoping predicate; the client then refetches the real rows through the **role-scoped REST index**, the authoritative access-control boundary. `ScreenshotBroadcastTest` asserts the payload keys are exactly `['screenshot_id','user_id']` and that `thumbnail_url/url/original_url/window_title/app_name` are absent (regression guard). Additionally, `ScreenshotUploaded::dispatch()` was moved out of the image-processing `try` block into its own guarded `try/catch(\Throwable)` after `finally`, so a momentarily-unreachable Reverb can no longer fail/retry the already-committed processing job (the `processed_at` guard would early-return the retry and drop the event).

**Web:**
- New `useScreenshotRealtime()` hook subscribes to the private `org.${orgId}` Echo channel (dynamic-auth singleton via `getEcho()`), mirroring the `TimerStarted` setup.
- On each event it **invalidates** the `['screenshots']` query so the list refetches with the page's current filters/pagination (invalidation chosen over prepend because the list is hourly-grouped, paginated, and multi-filtered).
- **Role scoping (defense in depth):** exported pure predicate `shouldRefetchForScreenshot(event, viewer)` — employee-role viewers ignore events whose `user_id !== own id`; owner/admin/manager refetch for any member. The server REST index still enforces role scoping authoritatively.
- **Lifecycle:** SSR-safe (`typeof window` guard; `getEcho()` returns null on server). The org channel is **shared with the timer store**, so cleanup uses `channel.stopListening('ScreenshotUploaded', handler)` — NOT `echo.leave()`, which would kill the timer listeners. Stable effect deps; listener removed on unmount; logout unmounts the page via the auth guard.

## Key files

- Backend: `app/Jobs/ProcessScreenshotJob.php`, `app/Events/ScreenshotUploaded.php`, `app/Support/ScreenshotUrl.php`, `tests/Feature/Screenshot/ScreenshotBroadcastTest.php` (new).
- Web: `web/src/hooks/use-screenshot-realtime.ts` (new, + `shouldRefetchForScreenshot` predicate + `ScreenshotUploadedEvent` type), `web/src/hooks/use-screenshot-realtime.test.ts` (new, 7 role-scoping tests incl. numeric `user_id` coercion), `web/src/app/(dashboard)/screenshots/page.tsx`.

## Verification

- Backend: `cd backend && ./vendor/bin/phpunit -c phpunit.local.xml --filter=Screenshot` → 21/21 (70 assertions; asserts the broadcast dispatches on upload with the exact minimal payload and no sensitive fields).
- Web: `npx tsc --noEmit` exit 0; `npx vitest run src/hooks/use-screenshot-realtime.test.ts` → 7/7 (role scoping incl. numeric coercion).

## Follow-up / QA note

Realtime path verified via unit tests only; recommend an end-to-end manual check with **Reverb running** — capture a screenshot from the desktop agent and confirm it appears on the web screenshots page without a refresh, and that an employee does not receive teammates' screenshots.
