# Saved time shows 00:00:00 in the desktop app after an offline auto-stop

**Status:** ✅ FIXED (2026-06-22, `develop`) — **+ follow-up fix 2026-06-23** (async `timer-stopped` re-emit overwrote the total with 0; see below)

**Scope:** Desktop agent — stopped-state "Today's Total" display when offline.

**Severity:** P2 — no data loss (time IS saved locally), but the app shows 00:00:00, looking like the work was lost.

## Symptom

Timer auto-stops on system sleep (notification: "Timer stopped due to system sleep. Your time up
to HH:MM was saved."), the app is **Offline**, and the popup shows **`00:00:00` / "Stopped"**
instead of the saved Today's Total.

## Root cause

The web/desktop "Today's Total" for the stopped state comes from the server. When offline:

1. `get-timer-state` (IPC) initialised `todayTotalForDisplay = 0` and only set it **inside**
   `if (apiClient) { try { …server… } catch {} }`. Offline, `getTimerStatus()` throws → `catch {}`
   → it returns **`todayTotal: 0`**. The renderer's `syncTimerState()` (runs on resume/focus)
   then did `todayTotalBase = state.todayTotal ?? 0` → wiped the display to `00:00:00`.
2. `stopTimer()` resets `todayTotalCurrentProject = 0` and, offline, can't refresh
   `todayTotalGlobal` (its `getTodayTotal()` also throws), so the in-memory total was stale/0 —
   nothing held the just-stopped session for the offline display to read.

## Fix (both in `desktop/src/main/index.js`)

- **`get-timer-state`** now computes a **local fallback first** (`todayTotalCurrentProject +
  current session` when running, else `todayTotalGlobal`) and only overwrites it with server
  values on a successful fetch. An offline/failed call keeps the local total instead of 0.
- **`stopTimer`** — on the offline branch (server total unreachable) it now adds the just-stopped
  `sessionElapsed` to `todayTotalGlobal` (which is the base excluding the session), so the saved
  session is reflected offline. Online, the authoritative server total still overwrites it (no
  double-count — the offline session syncs and the next online fetch replaces the local value).

## Verify

- `cd desktop && npm test` — 480/480.
- Manual: track offline → sleep (auto-stop) → wake (still offline) → popup shows the saved
  Today's Total, not 00:00:00. On reconnect it reconciles to the server total.

## Follow-up (2026-06-23) — async `timer-stopped` re-emit blanked the total on flaky network

Reported again on a **manual stop** over an intermittent connection (`ECONNABORTED`): the popup briefly showed the correct total, then dropped to **00:00:00**. The synchronous part of `stopTimer()` emits `timer-stopped` with the correct `localStoppedProjectTotal`, but the **async post-stop block** re-emitted it with:
```js
let todayTotalForPopup = result?.today_total ?? 0;   // ← 0 when server stop returned nothing
try { todayTotalForPopup = await apiClient.getTodayTotal(stoppedProjectId); } catch {}  // ← leaves it 0 on failure
notifyPopup("timer-stopped", { todayTotal: todayTotalForPopup });
```
On a failed network the `getTodayTotal` throws and `todayTotalForPopup` stays **0**, so the second `timer-stopped` overwrites the correct value → `00:00:00`. (The renderer's `onTimerStopped` sets `elapsedSeconds = data.todayTotal`.)

**Fix:** fall back to `localStoppedProjectTotal` (never 0) — initialise from it, only overwrite with the server total on a successful fetch, and in `catch` restore the local total. The stopped popup now matches the tray's Today's Total even when the stop can't reach the server.

## Key files

- `desktop/src/main/index.js` — `get-timer-state` IPC, `stopTimer()` offline today-total branch, **async post-stop `timer-stopped` re-emit (2026-06-23)**.
