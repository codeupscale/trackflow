# Idle alert never appears (all OSes) + a stack of idle windows after lock/sleep

| | |
|---|---|
| **Area** | Desktop agent — idle detection & idle alert window |
| **Platform** | All (macOS, Windows, Linux) |
| **Severity** | **P0** for (A) — idle enforcement was dead; P2 for (B) |
| **Reported** | 2026-07-31 (owner) |
| **Status** | ✅ FIXED (2026-07-31, branch `fix/desktop-idle-alert-never-appears`) |

---

## (A) No idle window ever appeared — one `.catch()` on a function that stopped returning a promise

### Symptom
Leave the machine untouched with the timer running. After the idle threshold
(10 min default) **no idle window appears — on any OS**. Tracking silently
freezes instead: the tray/popup stop counting, screenshots and activity capture
stop, and there is no prompt to continue or stop, so the only way out is to stop
and restart the timer.

### Root cause
The local-first refactor (`f2e1c45c`) made `pauseTimerForIdle()` **synchronous** —
the idle pause is now a pure local/SQLite operation with no server call. The
`onIdleDetected` handler in `index.js` still chained the old promise handler:

```js
pauseTimerForIdle(...).catch(() => {});   // ← undefined.catch  →  TypeError
renderIdleFreeze();
showIdleAlert(idleSeconds, idleStartedAt, actionId);   // never reached
```

Every idle detection threw `Cannot read properties of undefined (reading 'catch')`
**after** the pause had been applied (timer frozen, capture stopped) and **before**
`showIdleAlert()` could run. Hence: paused tracking, no window.

### Why it then stayed broken for the rest of the session
The throw escaped into `IdleDetector._check()`, which invoked the callback with
no protection, so the lines *after* the callback never ran:

```js
this._onIdleDetected(...)          // throws
this._state = IDLE_STATE.ALERTING; // skipped
this.checkInterval = setInterval(...) // skipped
```

The detector was left in **DETECTED with no interval** — idle was never detected
again for the whole session. Worse, `isIdleActive()` reports true for DETECTED,
so the idle **hard-stop watchdog** (`_idleWatchdogTick`, which stands down while
an alert is on screen) stood down permanently too: a machine left running all
night had no idle enforcement of any kind.

### Fix
1. `index.js` — call `pauseTimerForIdle()` plainly, inside a `try/catch` so a
   failed pause can never cost the user the alert. `showIdleAlert()` is wrapped in
   `Promise.resolve(...).catch(log)`, which both survives it ever becoming
   synchronous and logs a rejection instead of dropping it silently.
2. `idle-detector.js` — `_check()` wraps the `onIdleDetected` callback in
   `try/catch`, so **no caller exception can ever wedge idle detection again**.
3. `idle-detector.js` — the post-callback re-arm now only runs `if (this._state
   === IDLE_STATE.DETECTED)`. This also fixes a second, pre-existing bug: the
   `keep_idle_time` policies that never open a window (`always` resolves and
   re-starts, `never` discards) move the detector themselves, and forcing
   `ALERTING` over the top of that stomped their fresh `WATCHING` state and
   orphaned the interval `start()` had just armed — idle silently stopped working
   for those orgs after the first cycle.

---

## (B) Multiple idle windows after locking the laptop (reported on 1.0.44/1.0.45)

### Symptom
Lock the laptop with tracking running, come back an hour later, and **several
idle windows are stacked on screen**.

### Root cause
Two compounding causes:
- The alert was deliberately **mirrored onto every display** (one window per
  monitor — the old ISSUE 4 / `idle-alert-single-display-multimonitor.md` fix), so
  a two-monitor desk always got two windows.
- The teardown helper only reaped the **mirrors** (`_destroyIdleAlertExtras`),
  never a stale primary. A cycle interrupted by lock/sleep could leave a window
  alive that then coexisted with the freshly created one.

### Fix — the idle alert is now a strict singleton
- **One window**, created on the display the **cursor** is on (primary display as
  fallback). Mirroring is retired: the alert is `alwaysOnTop`, floats over
  fullscreen apps, and is set visible on all Spaces/workspaces, so a single window
  already reaches the user wherever they are — two identical modal windows was a
  worse answer than one shown in the right place.
- `_destroyAllIdleAlertWindows()` replaces `_destroyIdleAlertExtras()` and tears
  down **every** live alert window (marking each `_dismissedProgrammatically` so
  the close handler cannot re-arm the detector). It runs before any new alert is
  created, on primary close, and in `dismissIdleAlert()`.
- `_idleAlertExtraWindows` and the mirror-creation loop are gone.
- `showIdleAlert()` contains **no `await` between its "already showing?" guard and
  the window assignment**, so two concurrent calls cannot interleave into two
  windows (verified, and worth preserving).

---

## Files changed

| File | Change |
|---|---|
| `desktop/src/main/index.js` | sync `pauseTimerForIdle()` call + guarded `showIdleAlert()`; single-window idle alert; `_destroyAllIdleAlertWindows()` sweeper; mirror machinery removed |
| `desktop/src/main/idle-detector.js` | `_check()` guards the callback; re-arms to ALERTING only when the callback left the state in DETECTED |
| `desktop/test/idle-detector.test.js` | +3 tests: a throwing callback still leaves the detector armed, idle still fires on the next cycle, a resolve-and-restart callback stays WATCHING |
| `desktop/test/idle-alert-invariants.test.js` | **New.** Source-level guards: `pauseTimerForIdle` is never `await`ed/chained, exactly one alert window is constructed, the sweeper runs before creation, mirrors stay gone |

`npx jest` in `desktop/`: 43 suites / 737 tests pass.

## Manual QA

1. Start the timer, leave the machine alone past the idle threshold → **one** idle
   window appears (on the monitor the cursor is on), with sound.
2. Answer it ("Continue tracking" / "Stop timer"), go idle again → the alert
   appears a **second** time (this is the wedge that (A) caused).
3. Two monitors: exactly one window, on the cursor's display.
4. Lock the machine while the alert is up, return an hour later → still exactly
   **one** window, showing the full away duration.
5. Windows virtual desktops: the alert appears on the desktop you are on.
6. With `keep_idle_time` = `always` / `never`: no window (by policy), and idle
   still detects on subsequent cycles.
