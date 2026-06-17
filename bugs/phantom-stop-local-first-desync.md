# Phantom Stop — UI shows "Start" but timer is still running ("Timer already running")

**Status:** ✅ FIXED 2026-06-17 (branch `chore/desktop-electron-42-upgrade`, uncommitted at time of writing) — desktop suite 437/437 green.

## Resolution summary (2026-06-17)
The server-sync paths no longer discard an unsynced local-first session (all in
`desktop/src/main/index.js`):
- **`get-timer-state` IPC** — when the server reports `running=false` but an open local session
  exists with `synced_start` falsy, local state is **kept** (`isTimerRunning`/`currentEntry` not
  cleared). Reconcile pushes the start instead. (`keepLocalFirst` guard.)
- **10s sync loop** — same guard: a server "not running" while a local start is still unsynced is
  treated as stale and ignored (early-return like the idle-alert guard), so the loop never kills a
  local-first timer. Its `timer-stopped` notify now also carries `_stateVersion` so the renderer's
  stale-notification guard can reject it when a newer start has landed.
- **`startTimer()` guard** — when a Start click arrives while already running, the main process
  re-broadcasts `timer-started` (self-heal) so the popup corrects its button instead of only
  surfacing "Timer already running".

Net effect: the renderer can no longer be left showing **Start** while `isTimerRunning` is true, and
even a transient desync self-corrects on the next interaction.

---

**Status (original):** 🔴 OPEN — not yet fixed
**Reported:** 2026-06-17 (desktop user)
**Investigated:** 2026-06-17 (read-only, on branch `chore/desktop-electron-42-upgrade`)
**Scope:** Desktop agent (Electron) — main-process timer-state sync vs. renderer UI
**Severity:** P1 — the user believes tracking stopped (and may not restart → lost time), and the
"phantom running" state blocks starting a new timer until the app is restarted.

## Reported symptom

> Sometimes, after starting the timer and then clicking the cross / hide button (or "I don't
> know"), the popup shows the **Start** button again. Clicking Start then says **"time already
> started"** — the timer won't restart.

So the renderer UI is in the **stopped** state (Start button visible) while the main process still
believes a timer is **running**. The two have desynced.

## Where the user-facing message comes from

- `desktop/src/main/index.js:2157` — `startTimer()` guards with `if (isTimerRunning) return { error: 'Timer already running' }`.
- `desktop/src/renderer/index-renderer.js:403-404` — the Start click handler surfaces it: `else if (result.error) showNotification(result.error)`. ("Timer already running" = the "time already started" the user sees.)

For this message to appear, `isTimerRunning === true` in the main process **at click time**, even
though the renderer is showing Start. That is the desync to explain.

## Root cause — two main-process sync paths fight over local-first state

TrackFlow's timer is **local-first** (CLAUDE.md): a start writes to SQLite and sets
`isTimerRunning = true` immediately; if the API call fails the timer "continues running locally …
the local `started_at` is the source of truth and is **never overwritten**." (Local-first fallback
lives at `desktop/src/main/index.js:2264-2273`.)

Two server-sync paths violate that invariant by trusting the **server** over the local session:

### Path A — `get-timer-state` IPC nulls local state when the server says "not running"
- `desktop/src/main/index.js:1971-2010`. On every call it does `apiClient.getTimerStatus()` and, when
  `status.running` is false, hard-overwrites: `isTimerRunning = false; currentEntry = null;
  _cachedStartedAtMs = null` (lines 1987-1993) and returns `isRunning: false` to the renderer.
- It does **not** check for an open, unsynced local-first session (`getActiveLocalTimer()` /
  `currentEntry?._localId`) before discarding local state.
- This IPC is hit constantly: the popup hides on blur (`index.js:1707-1715`) and **every re-show**
  re-sends `sync-timer` (`showPopup()` → `index.js:1635-1637`), which makes the renderer call
  `getTimerState` again (`index-renderer.js:204-208`). Clicking the **hide/cross** button
  (`hideBtn`, `index-renderer.js:445-446`) is exactly this hide→reshow cycle.

### Path B — the 10s sync loop *kills* the local timer when the server says "not running"
- `desktop/src/main/index.js:2688-2710`. `else if (!status.running && isTimerRunning)` → sets
  `isTimerRunning = false; currentEntry = null`, stops the capture services, and emits
  **`timer-stopped`** to the renderer (line 2709) → renderer shows Start
  (`index-renderer.js:512` `onTimerStopped` → `updateDisplay(false)`).
- The only guard is "idle alert active" (line 2692). There is **no** guard for an unsynced
  local-first session.
- That `timer-stopped` notify carries **no `_stateVersion`**, so the renderer's stale-notification
  guard (`index-renderer.js:514`) can't reject it even if a fresh start is in flight.

### The contradiction (why it flip-flops instead of settling)
`reconcileTimerState()` does the **opposite** of Path B for the same condition: when the server has
no open entry but local is running, it **pushes the local start to the server** and keeps the timer
running — `index.js:2544-2563`. Both `reconcileTimerState` and the sync loop run under the same
`_timerStateMutationInProgress` guard (`index.js:2462`, `2648`), so **whichever wins a given 10s
tick decides the outcome**:
- If the **sync loop** wins → local timer is killed (`isTimerRunning=false`, `timer-stopped` sent → Start shown).
- If **reconcile** wins → the still-open SQLite session is pushed → server now reports running.

So the sequence that produces the exact symptom:
1. Timer started, but the start has **not reached the server** (offline, start-API timeout/5xx →
   local-first fallback at `index.js:2264-2273`; or the server auto-stopped it — see triggers).
   Main: `isTimerRunning = true`, SQLite session open.
2. A `get-timer-state` (Path A, on hide→reshow) or a sync-loop tick (Path B) sees server
   `running=false` → sets `isTimerRunning=false`, emits `timer-stopped` / returns `isRunning:false`
   → **renderer shows Start**.
3. The SQLite session is still open, so `reconcileTimerState` (or Path B of a later tick after the
   push) re-pushes it → server now reports `running=true` → the sync loop's
   `if (status.running && !isTimerRunning)` branch (`index.js:2668`) flips `isTimerRunning` back to **true**.
4. The renderer is still showing **Start** from step 2 (nothing re-synced it). User clicks Start →
   `index.js:2157` → **"Timer already running."**

## What triggers the server-vs-local divergence (step 1)

`getTimerStatus()` succeeding with `running=false` while local is running happens when:
- **Offline / weak network start** — start never synced (the canonical local-first case).
- **Start API timed out or 5xx'd** — `startTimer()` fell through to local-first mode (`index.js:2264-2273`).
- **Server-side auto-stop** — e.g. the duplicate-timer guard auto-closes an existing entry
  (`backend/app/Services/TimerService.php:171`) or a max-duration close, so the server entry the
  desktop expects is gone.
- **Started on another device / session.**

(If `getTimerStatus()` itself *throws*, the empty `catch {}` at `index.js:2000` keeps the prior
in-memory value, so a failed status call is safe. The bug needs a **successful** `running=false`.)

## Reproduction

1. Start the timer while **offline** (or block the `POST /timer/start` call so it 5xx/times out).
   The popup shows Tracking; the start is local-only.
2. Click the **hide/cross** button (or click away to blur the popup), then reopen it from the tray
   a few seconds later — let at least one 10s sync tick pass.
3. The popup shows the **Start** button.
4. Bring the network back (or wait for reconcile to push the start), then click **Start**.
5. → "Timer already running" / "time already started"; the timer won't restart without an app restart.

## Recommended fix

**Make the server-sync paths honor the local-first invariant — never discard an open, unsynced
local session:**

1. In **both** `get-timer-state` (`index.js:1971`) and the sync loop's `!status.running` branch
   (`index.js:2688`), before clearing local state, check `getActiveLocalTimer()` /
   `currentEntry?._localId`. If a local-first session is still open and not yet `synced_stop`,
   **keep `isTimerRunning=true`** and let `reconcileTimerState()` push the start — do not emit
   `timer-stopped` and do not return `isRunning:false`.
2. **Unify the contradictory behaviors:** route "server says stopped while local running" through
   the reconcile push (`index.js:2544-2563`) only. The sync loop should never be the thing that
   kills a local-first session.
3. Add a `_stateVersion` to the sync loop's `timer-stopped` notify (`index.js:2709`) so the
   renderer's stale-notification guard (`index-renderer.js:514`) can reject it when a newer start
   has landed.
4. Defensive: when `startTimer()` hits the `isTimerRunning` guard (`index.js:2157`), instead of a
   bare error, re-broadcast the authoritative running state (`timer-started` with the current
   entry) so the renderer self-heals to the correct button even if a desync slipped through.

**Verify after fixing:** offline-start → hide/reshow repeatedly → reconnect → the popup must keep
showing **Tracking/Stop** throughout, and Start must never be offered while `isTimerRunning` is
true. Re-run `desktop/test/offline-sync.test.js` and the timer-sync invariants.

## Notes

- Related but distinct from [timer-sync-bugs.md](timer-sync-bugs.md): that covered wrong durations /
  cross-closing entries. This one is specifically the **renderer ↔ main running-state desync**
  caused by server-truth overriding an unsynced local-first session.
- All `file:line` references were accurate on 2026-06-17 on branch
  `chore/desktop-electron-42-upgrade`; re-verify before fixing.
