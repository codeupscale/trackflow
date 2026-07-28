# Desktop — idle-prompt duration counted into the tracked time (and popup showed "Tracking" while paused)

**Status:** ✅ FIXED (2026-07-28)
**Severity:** P2 — no data corruption (the server entry is correctly paused at `idleStartedAt`), but the desktop display contradicts it. UX/trust bug: the employee watches the timer climb through minutes they did not work.
**Area:** Desktop agent — idle pause display (`desktop/src/main/index.js`, `desktop/src/renderer/index-renderer.js`)
**Branch:** `fix/idle-alert-lock-offline-screenshots-and-signout-sync`
**Reported by:** QA — "we tracked 4 minutes, waited for the idle window, and turned the internet off at that exact moment. It was paused (correct) but the idle time was added (wrong)."

## Symptom

1. Track ~4 minutes.
2. Stop touching the machine; wait for the idle threshold.
3. The idle window appears (Keep / Discard / Reassign).
4. Turn the network off at that moment.
5. The popup shows **`00:06:30`** and status **"Tracking"** — the ~2m30s the idle prompt has been on screen has been folded into the tracked total, even though the entry is paused and the idle period is still pending a keep/discard decision.

The server is fine throughout: `POST /timer/pause` is back-dated to `idleStartedAt`, and when it fails offline `retryIdlePauseIfUnsynced()` re-pushes it. Only the **desktop display** was wrong.

## Root cause

Two independent defects, one on each side of the IPC boundary. Either alone reproduces; together they made it reliable.

### 1. Main — `startTrayTimer()` had no `isTimerPaused` gate

`pauseTimerForIdle()` calls `stopTrayTimer()` and pushes one corrected "frozen" tick, so the *first* paint was right. But the per-second interval body only guarded `if (!isTimerRunning)`, and `isTimerRunning` stays **true** through an idle pause (the entry is still open, merely frozen). So any path that re-armed the interval resumed counting from `_cachedStartedAtMs` to `Date.now()` — which spans the entire idle window.

Callers that re-arm without knowing an idle decision is open:

| Site | Path |
|---|---|
| `onResumeAfterSleep` → `else if (isTimerRunning && !isIdleAlertActive())` | display sleep / lock-and-unlock while idle-paused |
| idle alert window `closed` handler → `if (!idleDetector?.isIdleActive())` | alert window closed without an action after the detector resolved |
| sync tick phantom-stop recovery | server says stopped, local SQLite still has an open session |

Turning the network off makes these far more likely: the offline branch of the sync tick and the reconnect/reconcile paths run while the alert is still up.

`updateTrayTitle()` had the same hole — it repainted the tray with a non-frozen total, wiping the `⏸ HH:MM:SS` text.

### 2. Renderer — `isRunning` was tested before `isPaused`

`get-timer-state` returns `{ isRunning: true, isPaused: true }` during an idle pause. `syncTimerState()` read them in the wrong order:

```js
if (state.isRunning) { ... updateDisplay(true, false); startTicking(); }   // ← wins
else if (state.isPaused) { ... updateDisplay(false, true); }              // ← unreachable
```

So every re-sync (popup re-opened from the tray, `sync-timer` broadcast, network-status change) repainted the popup as **"Tracking"**, re-enabled the tick listener, and cleared the local `isPaused` flag — which in turn let `onTimerTick`'s `if (!isRunning) return;` guard pass every subsequent live tick straight through.

Two smaller variants of the same mistake: `onTimerPaused`'s `data?.elapsed ?? calcElapsedFromStartedAt()` fallback and `syncTimerState`'s `state.elapsed || calcElapsedFromStartedAt()` both measure to `Date.now()`, re-introducing the idle window whenever the frozen value was `0`/absent.

## Fix

**Main (`desktop/src/main/index.js`)**

- New `displayAnchorMs()` — the single instant the visible elapsed is measured to. `Date.now()` normally; **`idleDetector.idleStartedAt` while `isTimerPaused`**, with `_idleFreezeAnchorMs` (stamped synchronously in `pauseTimerForIdle()` before any `await`) as a backstop for when the detector has re-armed and lost its anchor.
- New `computeDisplaySeconds()` / `renderIdleFreeze()` — one idempotent repaint of tray (`⏸ HH:MM:SS`) + popup, so every path that touches the display mid-idle lands on the same frozen value instead of resuming the count. The frozen popup tick is flagged `isPaused: true`.
- `startTrayTimer()` now returns early (rendering the freeze) when `isTimerPaused`; the interval body re-checks `isTimerPaused` and stands down, covering a re-arm that races the pause.
- `updateTrayTitle()` delegates to `renderIdleFreeze()` while idle-paused.
- `onIdleDetected` now calls `pauseTimerForIdle()` **before** the repaint (it flips `isTimerPaused` and stamps the anchor synchronously), replacing the hand-rolled `now − started − idleSeconds` arithmetic with `renderIdleFreeze()`.
- `get-timer-state` uses `displayAnchorMs()` for `elapsed`.
- `resumeTimerAfterIdle()` clears `_idleFreezeAnchorMs`. All resume paths already call it before `startTrayTimer()`, so the live count re-arms correctly.

**Renderer (`desktop/src/renderer/index-renderer.js`)**

- `syncTimerState()` checks `state.isPaused` **before** `state.isRunning`.
- `onTimerTick` drops any tick **not** flagged `isPaused` while the popup is paused, and always applies a flagged one (which also flips the UI to "Paused (idle)").
- Removed both `calcElapsedFromStartedAt()` fallbacks on the paused paths.

## Verification

`desktop/test/idle-freeze-display.test.js` — 18 tests mirroring the pure rules (per the `timer-sync-invariants.test.js` convention, since `index.js` cannot be imported without booting Electron):

- frozen display is the tracked 4:00, not the wall-clock 6:30;
- the value does not grow as the prompt sits on screen;
- backstop anchor is used when the detector re-armed; garbage anchors ignored;
- resuming returns to the live clock;
- `startTrayTimer` gate, renderer state precedence, renderer tick filter.

Full desktop suite: **671 passed / 41 suites**.

## Notes / residual

- No backend change. The server was always correct; this was purely a display defect.
- The idle period itself is still decided by the user (Keep / Discard / Reassign) — that behaviour is unchanged.
- Related: [desktop-idle-alert-timer-resumes-on-reconnect.md](desktop-idle-alert-timer-resumes-on-reconnect.md) (server "running" must not win while an alert is open), [desktop-idle-window-multiscreen-and-sleep.md](desktop-idle-window-multiscreen-and-sleep.md) (alert survives sleep).
