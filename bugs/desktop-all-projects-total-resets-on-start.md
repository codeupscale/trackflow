# "Today, all projects" drops to zero for ~10 seconds after starting a timer

**Status:** ✅ FIXED (2026-07-28)
**Severity:** P2 — cosmetic but alarming: the user sees the day's total vanish the moment they
start tracking, then reappear.
**Scope:** `desktop/src/main/index.js` (`afterStartTimer`, `applyRunningStatusFromServer`,
`switchProject`), `backend/.../TimerController`.

## Symptom (owner, 2026-07-28)

> "when a project time is started, the total time of project starts from zero and after 10 seconds
> shows the correct time — can it not show correct from the start?"

Ten seconds is the desktop's `startTimerSync()` interval: the next status tick repaired the value.

## Root cause

`POST /timer/start` returns `today_total` **scoped to the started entry's project**
(`$this->timerService->todayTotal($entry->project_id)`). `afterStartTimer()` assigned that scoped
number to the global field:

```js
todayTotalGlobal = todayTotalForPopup;   // ← project-scoped value
```

`todayTotalGlobal` backs the popup's "Today, all projects" line and the tray "Today: X" tooltip.
Start a project with no time logged today and the line reads `00:00:00` until the next sync tick
recomputed it from `/timer/status`.

Same class of bug as
[desktop-today-total-project-scoped-when-project-selected.md](desktop-today-total-project-scoped-when-project-selected.md),
which fixed the `get-timer-state` handler. Two paths were missed then and are fixed now:

- `applyRunningStatusFromServer()` — `todayTotalGlobal = Math.max(0, status.today_total - elapsed)`,
  and `get-timer-state` calls `/timer/status?project_id=…`, so `today_total` is scoped there too:
  while the timer ran, re-opening the popup collapsed the global line to the selected project.
- `switchProject()` — `today_total` in the switch response is scoped to the **new** project.

## Fix

**Backend** — `start`, `stop` and `switch` now also return `all_projects_today_total` (the same
never-scoped field `/timer/status` has returned since the earlier fix). It is computed via a
private helper that skips the extra query when the entry has no project (scoped == global).

**Desktop**

- `afterStartTimer()` no longer overwrites `todayTotalGlobal`. Starting a timer cannot change the
  completed all-projects sum, so the existing value is already correct; when the backend supplies
  `all_projects_today_total` it is adopted (minus the new entry's ~0 s elapsed, because the desktop
  keeps `todayTotalGlobal` as the completed base and adds live elapsed per tick).
- `applyRunningStatusFromServer()` prefers `all_projects_today_total`, falling back to
  `today_total` for older backends.
- `switchProject()` adopts the global figure when present.

## Key files

- `backend/app/Http/Controllers/Api/V1/TimerController.php` — `allProjectsTodayTotal()` helper.
- `desktop/src/main/index.js` — `_startAllProjectsTotal`, `afterStartTimer()`,
  `applyRunningStatusFromServer()`, `switchProject()`.
- `desktop/test/idle-lock-and-timer-adoption.test.js` — "all-projects total is never overwritten
  by a project-scoped one".
- `backend/tests/Feature/Timer/TimerTest.php` — Redis call counts updated for the extra
  global-total query (only made when the entry has a project).

## Related

- [desktop-today-total-project-scoped-when-project-selected.md](desktop-today-total-project-scoped-when-project-selected.md)
- [desktop-project-total-frozen-while-tracking.md](desktop-project-total-frozen-while-tracking.md)
