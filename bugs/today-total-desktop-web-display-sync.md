# Today-total display drift: desktop +1s vs web, and stale "Today's Hours" card

**Status:** ✅ FIXED (2026-06-24, `develop`) — display-layer only; no data corruption.

**Scope:** Desktop popup stopped-display + web dashboard "Today's Hours" card. The stored data
(time_entries / server today_total) was always correct.

**Severity:** P3 — cosmetic, but erodes trust ("why is it always off / stale?").

## Symptom (reported)

- Desktop widget showed `00:06:03` while the web portal chip showed `06:02` (1s higher on
  desktop) after stopping.
- Web dashboard "Today's Hours" card showed `0h 12m` while the live total was `~6m`.

## Root cause

1. **Desktop +1s.** While running, the desktop big number is a *live* counter:
   `floor((now − localStart) / 1000)`. The server stores each entry's duration floored from its
   own received timestamps, so the two can differ by up to 1s on the sub-second boundary. On
   stop, the renderer paints the last live tick (e.g. 6:03) and `stopTimer()`'s IPC *return*
   value is the **local** total (also 6:03), so the `!== stoppedTotal` guard never fires; the
   server-authoritative value (6:02) only arrived via the async `timer-stopped` event, which
   could be missed/slow → display stuck at +1s.
2. **Stale card.** The dashboard `['dashboard']` query only refetched on a 30s `refetchInterval`,
   so for up to 30s after a start/stop the card lagged the live timer chip. The backend
   `today_seconds` (closed tracked + running elapsed) is itself correct — not a double-count.

## Fix

1. **Desktop:** after `stopTimer()` resolves, the renderer stop handler calls
   `syncTimerState()`, which does a fresh `get-timer-state` (server status) and, when stopped,
   displays the server total — converging off the +1s remainder. Offline it falls back to the
   local total (never 0), preserving the
   [desktop-today-total-zero-offline-after-autostop](desktop-today-total-zero-offline-after-autostop.md)
   fix. (`desktop/src/renderer/index-renderer.js`)
2. **Web:** the dashboard page now invalidates `['dashboard']` and `['time-entries-dashboard']`
   the instant the timer's running state flips (via `useTimerStore`), so the card + timesheet
   refresh immediately instead of waiting up to 30s.
   (`web/src/app/(dashboard)/dashboard/page.tsx`)

## Note on the running-while-tracking case

When a timer is actively running, the desktop and web are two **independent live counters** on
different clocks/render phases; a ≤1s instantaneous difference is unsynchronized tick timing, not
a bug, and cannot be made pixel-perfect without making the counter non-live. The fixes above make
the **stopped** total converge and the **card** refresh promptly.

## Verify

- `cd desktop && npm test` → 492/492. `cd web && npx tsc --noEmit` → clean.
- Manual: stop a timer → desktop total settles to the server value (matches portal); the
  dashboard "Today's Hours" card updates immediately on start/stop.

## Key files

- `desktop/src/renderer/index-renderer.js` — stop handler `syncTimerState()` convergence.
- `web/src/app/(dashboard)/dashboard/page.tsx` — invalidate dashboard queries on timer transition.
- `backend/app/Http/Controllers/Api/V1/DashboardController.php` — `today_seconds` (verified correct).
