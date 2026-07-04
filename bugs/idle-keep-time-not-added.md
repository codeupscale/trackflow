# Desktop — "Keep idle time" appears to not add idle time

**Status:** 🟡 NEEDS PRODUCT DECISION — current code is behaving as designed; the symptom is most likely a stale-action/auto-stop timing trap or a build/measurement mismatch, **not** a defect in the keep path.
**Reported:** 2026-06-18 (QA, production instance)
**Investigated:** 2026-06-18
**Scope:** Desktop agent (Electron) — idle-alert "Keep" action ↔ local-first single-timestamp timer model
**Severity:** P2 — no data loss in the normal keep path; risk is UX confusion + an edge case where keep is silently aborted.

## Symptom (as reported)

> "He clicked on 'Keep idle time' but idle time was not added."

The user added: *"idle time related work is maybe already done but I'm wrong"* — and that intuition is
broadly correct. The earlier idle fixes (see [auth-and-idle-bugs.md](auth-and-idle-bugs.md), BUG B —
spurious `start()` clobbering a live alert) are unrelated to this report; this is about what "Keep"
*does* once clicked.

## Verdict

**"Keep" is intentionally a client-side no-op, and that is the correct design.** Under the local-first
single-timestamp model, the idle interval is retained automatically because the entry's `started_at` is
never moved and the entry is closed at `now` on stop. There is nothing to "add back" — the time was never
removed in the first place. So a *correctly* functioning keep produces an entry whose duration already
*includes* the idle minutes.

The QA observation that idle time "was not added" therefore points to one of the failure/expectation modes
below rather than a bug in the keep branch itself.

## End-to-end "Keep" data flow

1. **Renderer click** — `desktop/src/renderer/idle-alert.js:134`
   `keepBtn` → `sendAction('keep')` (`:127-132`) → `window.trackflow.resolveIdle('keep', null, currentActionId)`.
2. **Preload bridge** — `desktop/src/preload/index.js:40` → `ipcRenderer.invoke('resolve-idle', …)`.
3. **IPC handler** — `desktop/src/main/index.js:2056-2063`: validates against the whitelist
   `['keep','discard','stop','reassign']` (`validateIdleAction`, `index.js:1742`) → `handleIdleAction('keep', actionId, null, null)`.
4. **`handleIdleAction` keep branch** — `desktop/src/main/index.js:3063-3076` (the entire handling):
   ```js
   case 'keep':
     // Idle period kept as billable work on the SAME entry...
     activityMonitor?.start();
     if (isTimerRunning && currentEntry) {
       screenshotService?.start(currentEntry.id, { immediateCapture: ... });
     }
     idleDetector?.start();
     startTrayTimer();
     break;
   ```
   It does **not** call `apiClient.reportIdleTime()`, does not split the entry, does not move `started_at`.
   It resumes activity/screenshot capture and re-arms idle detection on the same `currentEntry`.
5. **Backend** — never invoked for keep. For completeness, `TimerController::idle()`
   (`backend/app/Http/Controllers/Api/V1/TimerController.php:160-162`) short-circuits keep:
   `if ($request->action === 'keep') return response()->json(['message' => 'Idle time kept.']);` — also a no-op.
   Only discard/reassign/stop reach `TimerService::reportIdle()`, which splits the entry (closes at
   `idle_started_at`, optionally writes a discarded idle entry, reopens at `idle_ended_at`). That split is
   what *removes* idle time; keep skips it.

## Why "keep = no-op" is correct

Tracked time = `ended_at − started_at`; the local `started_at` is the source of truth and is never
overwritten (CLAUDE.md, "Local-first timer architecture"). On stop (`index.js:730`, `:1924`) the entry
closes with `{ started_at: currentEntry.started_at, ended_at: now }`. Leaving the entry untouched on keep
is exactly what keeps the idle seconds inside the `started_at → ended_at` span.

## The real risks that make "Keep" *look* broken

1. **Stale-action / auto-stop race (most likely cause of the QA report).**
   If the auto-stop countdown elapses (or a competing action fires) before/while the user clicks Keep,
   `idleDetector.resolveIdle(actionId)` returns `null` for the now-stale click (guard
   `idle-detector.js:201-212`; abort at `index.js:3047-3052`, warning `[handleIdleAction] Action "keep" aborted`).
   Auto-stop (`index.js:976-990` → `handleIdleAction('stop', …)` → `reportIdleTime({action:'discard'})`,
   `index.js:3156-3162`) **discards** the idle interval and stops the timer. So a user who clicks "Keep"
   *after* the countdown ended sees the idle time gone — discarded by the stop path, not kept. To the user
   this is indistinguishable from "Keep didn't add the time."
2. **Stale production build.** Keep-as-no-op is the current main-line behavior. An older deployed build
   may have attempted a split or hit a backend error on keep. **Verify the deployed build SHA.**
3. **Measurement point.** The ground truth is the closed entry's `ended_at − started_at` (web dashboard
   time-entry duration), not a live UI counter that may be mid-reconcile. Confirm QA measured after stop.

## Recommended next steps

1. **Reproduce on the exact production build with logging.** Check the PostHog `idle_action` event
   (`index.js:3044`) to confirm the action actually received was `keep` (not `stop`/auto-stop `discard`),
   and that `idleDetector.resolveIdle` did not return `null` (the abort warning at `index.js:3050`).
2. **Confirm measurement:** verify tracked time was read from the stopped entry's duration, not a live counter.
3. **Product hardening options (optional — not current defects):**
   - **Make keep explicit/auditable:** in `case 'keep':` (`index.js:3063`) optionally
     `await apiClient.reportIdleTime({ …, action: 'keep' })` — the backend already accepts & no-ops it
     (`TimerController.php:160-162`). This records the decision server-side so reconcile can never "correct" it.
   - **Close the stale-click trap:** when a keep click arrives after auto-stop already discarded, surface a
     clear toast ("Timer was auto-stopped after N min idle; idle time was discarded") instead of silently
     aborting — so the user understands why their "Keep" had no effect.

## Files cited (verify before fixing)

| What | Location |
|---|---|
| Renderer keep button → `sendAction('keep')` | `desktop/src/renderer/idle-alert.js:127-134` |
| Preload `resolveIdle` bridge | `desktop/src/preload/index.js:40` |
| IPC `resolve-idle` handler + action whitelist | `desktop/src/main/index.js:2056-2063`, `:1742` |
| `handleIdleAction` keep branch (no-op) | `desktop/src/main/index.js:3063-3076` |
| Stale-action abort guard | `desktop/src/main/index.js:3047-3052`; `desktop/src/main/idle-detector.js:201-212` |
| Auto-stop → discard path | `desktop/src/main/index.js:976-990`, `:3156-3162` |
| Stop closes entry with preserved `started_at` | `desktop/src/main/index.js:730`, `:1924` |
| `idle_action` telemetry | `desktop/src/main/index.js:3044` |
| Backend keep no-op | `backend/app/Http/Controllers/Api/V1/TimerController.php:160-162`; route `backend/routes/api.php:108` |

All line references verified on branch `chore/desktop-electron-42-upgrade` (2026-06-18) — re-verify before acting.
