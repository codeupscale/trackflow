# Desktop shows "Tracking" but web shows "Not tracking" — unsynced local start never gets pushed

**Status:** ✅ FIXED 2026-06-17 (branch `develop`, uncommitted at time of writing) — desktop suite 441/441 green (+4 new tests).

## Resolution summary (2026-06-17)
The 10s `startTimerSync` loop in `desktop/src/main/index.js` previously **kept** an unsynced
local-first session when the server reported `running=false` (correct — see
[phantom-stop-local-first-desync.md](phantom-stop-local-first-desync.md)) but then just **bailed**,
never pushing the stranded start. With no offline→online transition to trigger
`reconcileTimerState()`, the start stayed unsynced forever: desktop tracked, web showed "Not
tracking", indefinitely.

Fix (`index.js:2712-2731`): when the loop detects `server.running===false && isTimerRunning===true`
with an open unsynced local session (`!_localActive.synced_start`), it now **drives a reconcile**
instead of only protecting local state. It releases the `_isSyncing` / `_timerStateMutationInProgress`
guards **first**, then schedules `setImmediate(() => reconcileTimerState().then(() => offlineQueue.flush(apiClient)).catch(() => {}))`
— the same release-then-reconcile-then-flush pattern used on resume (`index.js:1267`) and idle-action
(`index.js:3177`). Reconcile's Phase 2 (`index.js:2529-2557`) re-POSTs the start with the **original
`idempotency_key`** and the **real local `started_at`**, captures the server entry id, and is
idempotent (409 = already synced), so repeated 10s ticks are safe and self-cancel once `synced_start`
flips. Gated on `networkMonitor?.isOnline` so it doesn't churn while genuinely offline (the `'online'`
handler at `index.js:950` owns that case).

Net effect: a desktop stuck "tracking locally but invisible to the server" now self-corrects within
~10s of the API becoming reachable, even when there was never a network offline→online edge to hook
onto.

Added `desktop/test/timer-sync-invariants.test.js` (+4 tests): reconcile scheduled after guard
release when unsynced+online; NOT scheduled while offline; start pushed with original key + real
`started_at`; reconcile no-ops if invoked while the mutation guard is still held (proves the
release-ordering is load-bearing).

---

**Status (original):** 🔴 OPEN — not yet fixed
**Reported:** 2026-06-17 (desktop user — screenshot: Electron app tracking ongoing, web portal header shows "Not tracking")
**Investigated:** 2026-06-17 (read-only, branch `develop`)
**Scope:** Desktop agent (Electron) main-process timer sync ↔ Backend `GET /timer/status`
**Severity:** P1 — time is being tracked locally but is invisible to the org/admin and to reports
until the start is pushed; if the user stops before reconnecting cleanly, the session may be
mis-attributed or appear never to have happened on the server.

## Reported symptom

> Electron app time tracking is ongoing but web portal says **Not tracking**.

The desktop popup shows the running timer; the web dashboard header (`TimerWidget`) shows "Not
tracking". The two have desynced and stay that way.

## Where each side gets its truth

- **Web** polls `GET /api/v1/timer/status` every 10s (`web/src/stores/timer-store.ts:142`) plus
  Reverb `TimerStarted`/`TimerStopped` events. The widget shows "Not tracking" when
  `isRunning===false` (`web/src/components/timer-widget.tsx:79`). The server reports `running:true`
  **only** if a `time_entries` row has `ended_at IS NULL` (mirrored by Redis `timer:{user_id}`) —
  `backend/app/Services/TimerService.php` `status()`.
- **Desktop** is local-first: `startTimer()` writes a `timer_sessions` SQLite row and sets
  `isTimerRunning=true` **before** calling `POST /timer/start` (`index.js:2210-2230`). The desktop UI
  trusts that local state.

So the desktop can show "Tracking" with **nothing on the server** whenever the start never synced.

## Root cause — the unsynced start is protected but never pushed

This is the **mirror image** of [phantom-stop-local-first-desync.md](phantom-stop-local-first-desync.md).
That bug was "server-truth *kills* the local timer"; its fix added a guard so the 10s sync loop
**keeps** local state when the local start is unsynced (`index.js:2716-2722`). Correct — but the
guard only *preserved* the local timer; it **early-returned without ever pushing the start**:

```js
const _localActive = getActiveLocalTimer();
if (_localActive && !_localActive.synced_start) {
  console.log('[TimerSync] Server says stopped but local start is unsynced — keeping local state');
  _isSyncing = false;
  _timerStateMutationInProgress = false;
  return;   // <-- kept, but never pushed
}
```

`reconcileTimerState()` is the **only** code path that pushes an unsynced start to the server
(`index.js:2529-2557`). Its triggers are:
- `networkMonitor.on('online')` — offline→online **transition** (`index.js:950`)
- app startup (`index.js:1116`)
- window focus (`index.js:1267`)
- idle action (`index.js:3091`)
- sleep resume (`index.js:3177`)

**None of these fire when the start fails transiently with no network transition** — e.g. a `POST
/timer/start` timeout or 5xx, or a brief blip that Electron's `net.isOnline()` never reports as
offline. In that case:

1. Start click → local SQLite row, `isTimerRunning=true`, popup shows Tracking (`index.js:2210-2230`).
2. `POST /timer/start` throws transiently → caught, `success:true, offline:true` returned;
   `synced_start` stays `0`; server has no entry (`index.js:2233-2287`).
3. `net.isOnline()` was true throughout → no `'online'` event → reconcile never triggered.
4. Every 10s the sync loop sees `status.running===false`, hits the guard above, keeps local state,
   and **returns without pushing**. Stuck.
5. Heartbeats every 30s reach `POST /timer/heartbeat`, find no Redis key, and get
   `404 "No timer is currently running"` (`TimerService.php:966`) — a dead-obvious "server has no
   timer" signal that nothing acts on. They queue to the offline queue and never re-drive the start.

Result: desktop tracks forever; web shows "Not tracking" forever.

## Why the other divergence paths self-heal (and this one didn't)

- **Start synced, then auto-closed server-side** by `timer:cleanup-stale` (no heartbeat 30 min,
  `CleanupStaleEntries.php`) or `CloseStaleTimerEntriesJob` (`updated_at` > 2h): here
  `synced_start=1`, so the sync loop's stop branch runs and the desktop stops locally within 10s.
  (Note: heartbeats bump `time_entries.updated_at` via the `activity_score` update at
  `TimerService.php:1016`, so an actively-tracking timer is *not* killed by the 2h job.)
- **The unsynced-start path** is the only one that produces a *persistent* "desktop tracking / web
  not tracking" — which is exactly the reported symptom.

## Reproduction

1. Start the timer while `POST /timer/start` is blocked to time out or 5xx (DevTools network
   throttle/block, or kill the API briefly) **without** dropping the OS network interface, so
   `net.isOnline()` stays `true` and no `'online'` event fires.
2. Restore the API. Do **not** restart the app, refocus the window, or let the machine sleep.
3. Observe: desktop popup keeps showing Tracking; web `GET /timer/status` keeps returning
   `running:false`; header shows "Not tracking" — indefinitely, across many 10s ticks.

## Fix (implemented)

See **Resolution summary** above. In short: the sync loop's unsynced-start guard now releases the
mutation guards and schedules `reconcileTimerState()` (gated on `networkMonitor.isOnline`) so the
stranded start is pushed on the very next tick rather than waiting for a network transition that may
never come.

**Considered follow-up (not implemented):** the `404` from `processHeartbeat` is a strong
"server-has-no-timer" signal arriving every 30s. The activity-monitor could also trigger a reconcile
on heartbeat 404 as a belt-and-suspenders path. Left out to keep the fix minimal and avoid duplicate
reconcile drivers.

## Notes

- Directly continues [phantom-stop-local-first-desync.md](phantom-stop-local-first-desync.md): that
  fix made the sync loop *keep* the unsynced session; this fix makes it *push* it. Together they make
  the local-first start fully self-correcting.
- All `file:line` references were accurate on 2026-06-17 on branch `develop`; re-verify before
  further work.
