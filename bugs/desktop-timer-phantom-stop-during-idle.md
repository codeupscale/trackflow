# Desktop timer stops early + idle window flashes and disappears

**Status:** 🔴 OPEN (root cause identified, desktop fix in progress on `develop`)

**Scope:** Desktop agent — `TimerSync` loop (`index.js`), `shouldPreserveLocalRunningWhenServerStopped()`, `IdleDetector`, idle alert window.

**Severity:** P0 — core time-tracking. Multiple devs report:

1. Timer stops after ~2 hours despite working longer ("app band ho jati hai" / time stops)
2. Idle popup appears then vanishes before they can act ("gaeeb ho jati ha")
3. Time stops automatically without clicking anything

## Symptoms (user reports)

| Report                       | Likely manifestation                                         |
| ---------------------------- | ------------------------------------------------------------ |
| "Worked only 2 hours today"  | Server/desktop timer closed early; only ~2h credited         |
| "Idle window comes and goes" | `dismissIdleAlert()` fired while idle decision still pending |
| "Time automatically stops"   | Auto-stop after idle grace OR phantom-stop from sync         |

## Root causes (ranked)

### 1. TimerSync phantom-stop ignored paused idle state (P0 — fixed locally)

Every 10s the sync loop fetches `/timer/status`. When the server reports **no open timer** but local state is still `isTimerRunning || isTimerPaused`, it **hard-stops** the desktop timer, calls `idleDetector.stop()`, and `dismissIdleAlert()`.

The guard only checked `idleDetector.isIdleActive()` (DETECTED/ALERTING). It did **not** use the existing `shouldPreserveLocalRunningWhenServerStopped()` helper, which already returns `true` when:

- `isTimerPaused` (timer server-paused for idle — always true during idle prompt)
- Hidden idle window / SUSPENDED detector (sleep/lid with Bug B preservation)
- Unsynced local-first start

**During idle (including sleep with hidden window):** `isIdleActive()` is often `false` (SUSPENDED) while `isTimerPaused` is `true`. Sync killed the timer and destroyed the idle window → popup flashes/disappears, timer stops, user loses the Keep/Discard/Reassign choice.

**Evidence:** `index.js` ~4354–4413 (TimerSync) and ~2253–2281 (immediate sync) used `isIdleActive()` only; `shouldPreserveLocalRunningWhenServerStopped()` at ~957 already handled `isTimerPaused` but was unused in those paths.

**Fix:** Route both phantom-stop branches through `shouldPreserveLocalRunningWhenServerStopped()`; extend it with `isIdleAlertActive()`; use `isIdleAlertActive()` in `reconcileTimerState` and before `idleDetector.stop()` in `syncOpenTimerFromServerStatus`; make `IdleDetector.start()` a no-op in `SUSPENDED` state.

### 2. Server auto-closes stale entries when heartbeats lag (P1 — operational + monitoring)

`timer:cleanup-stale` (every 5 min, prod scheduler) closes running entries with no server-received heartbeat for `offline_grace_minutes` (default **4h**). If heartbeats fail to land (dev `ECONNABORTED`, network blips) while the desktop still tracks locally, the next TimerSync sees "server stopped" and — before fix #1 — killed local state at the last heartbeat timestamp (~2h credited if heartbeats died 2h ago).

**Check on dev:** `TIMER_OFFLINE_GRACE_MINUTES` env, Laravel scheduler running, `[cleanup]` logs in `storage/logs`.

### 3. False idle detection (P2 — platform-specific)

`powerMonitor.getSystemIdleTime()` can report idle while the user is reading/thinking (no keyboard/mouse). Default threshold is **5 minutes** (`idle_timeout`). After threshold → idle popup → **10 min auto-stop** (`idle_alert_auto_stop_min`) if no action → timer stops with notification.

This is by design but feels like "automatic stop" if the popup was missed (multi-monitor/Space — see `bugs/desktop-idle-window-multiscreen-and-sleep.md`).

### 4. Desktop timer ≠ HR check-in (P2 — separate product surface)

Stopping the desktop tracker does not check out on the web attendance card. See `bugs/checkin-desktop-timer-not-checkout.md`.

## Fix summary (desktop)

| File                                 | Change                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `desktop/src/main/index.js`          | Phantom-stop uses `shouldPreserveLocalRunningWhenServerStopped()`; `isIdleAlertActive()` includes SUSPENDED; reconcile/sync respect idle alert |
| `desktop/src/main/idle-detector.js`  | `start()` no-op during SUSPENDED                                                                                                               |
| `desktop/test/idle-detector.test.js` | Regression test for SUSPENDED `start()`                                                                                                        |

## Verify

- `cd desktop && npm test` — idle-detector + idle-sleep-preservation suites green
- Manual: start timer → go idle → confirm popup stays through TimerSync ticks (wait 30s+) → act on Keep/Discard
- Manual: idle popup showing → lock laptop → unlock → popup reappears with full duration, timer not stopped
- Prod/dev logs: grep `[TimerSync] Server says stopped but local idle/paused` vs `[TimerSync] sync failed`

## Recommended follow-up

1. Deploy desktop build with TimerSync fix to dev cohort
2. Confirm dev `TIMER_OFFLINE_GRACE_MINUTES` and heartbeat delivery (activity monitor logs)
3. Survey affected devs: OS (macOS/Windows/Linux), multi-monitor, VPN, idle threshold org setting
