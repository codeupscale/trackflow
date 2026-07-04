# Desktop — timer "restarts itself" after Stop on slow/failed network

**Area:** Desktop timer sync ↔ `/timer/status` (`index.js` immediate + periodic sync loops)
**Severity:** P1 (user stops the timer but it keeps/looks-like tracking → over-counted time; requires a second Stop)
**Status:** ✅ FIXED (2026-06-23) — branch `fix/desktop-timer-self-restart-after-stop-on-slow-network`

## Symptom
User clicks **Stop** (e.g. at 02:01). The timer appears to **restart on its own** and keeps counting; the user has to click Stop again. The recorded entry ends up longer than intended (observed: stopped at 02:01, entry recorded 02:41). Reproduced when the network to the API is slow/intermittent.

## Scope
Any Stop that lands while the desktop can't reach the API (slow link, timeout, DNS failure). The local-first stop is saved correctly; the **UI/state flips back to running**. Triggered heavily on the dev stack by intermittent reachability of `dev.trackflow.codeupscale.com` — see [desktop-timersync-econnaborted-intermittent.md](desktop-timersync-econnaborted-intermittent.md).

## Root cause
On Stop, the local stop is saved (`timer_sessions.ended_at` set, `synced_stop = 0`) and the in-memory timer is set stopped. But if the **server** `POST /timer/stop` fails (timeout/DNS), the server's Redis still shows the timer **open**. The two timer-sync loops both do:
```js
if (isServerTimerOpen(status) && !isTimerRunning) {
    syncOpenTimerFromServerStatus(status); // re-adopts server "running" → RE-OPENS the timer
}
```
So the next 10s status poll sees "server running, local stopped" and **re-opens** the timer to match the (stale) server — the self-restart. Evidence: `desktop/src/main/index.js` immediate-sync (~L1962) and `startTimerSync()` periodic loop (~L3767).

The over-count (02:41 vs 02:01) followed because the user clicked Stop again ~40s later to stop the re-opened timer.

## Fix
A server "open" status must not re-adopt a timer that the user **stopped locally but hasn't synced yet**. Added `hasUnsyncedLocalStopForEntry(serverEntryId)` — checks `timer_sessions` for a row matching the server entry with `ended_at IS NOT NULL AND synced_stop = 0`. Both re-open sites now guard on it:
```js
if (isServerTimerOpen(status) && !isTimerRunning) {
    if (hasUnsyncedLocalStopForEntry(status.entry?.id)) {
        scheduleReconcileAndFlush();   // push the pending stop; keep UI stopped
    } else {
        syncOpenTimerFromServerStatus(status);
    }
}
```
Reconcile (Pass 1a, `syncSessionStop`) then pushes the stop bound to the server entry id with the local `ended_at`, so the server closes the entry at the **user's** stop time — no re-open, no double-stop, no over-count. The legitimate "timer started elsewhere (web/other device)" case is unaffected: no local ended-unsynced row exists for that entry, so the guard is false and adoption proceeds normally.

Files: `desktop/src/main/index.js` (`hasUnsyncedLocalStopForEntry`, immediate-sync guard, `startTimerSync` guard).

## Related
- [phantom-stop-local-first-desync.md](phantom-stop-local-first-desync.md), [timer-reset-after-break-phantom-stop.md](timer-reset-after-break-phantom-stop.md) — sibling local-first desync defects. This is the inverse: an unsynced **stop** being overridden by a stale server **running** status.
- [desktop-timersync-econnaborted-intermittent.md](desktop-timersync-econnaborted-intermittent.md) — the network condition that triggers it.

## Verify
Start → ~1 min → throttle/cut network → Stop → restore network. Timer must stay **stopped** (no restart), and the entry's end time must equal the Stop click time, not a later reconcile time.
