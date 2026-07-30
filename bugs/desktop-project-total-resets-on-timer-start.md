# Starting a timer reset the project total to 00:00:00, then jumped to the real value

**Status:** ✅ FIXED (2026-07-30)
**Severity:** P2 — cosmetic, but it reads as "my tracked time was lost", which is the most alarming
thing this product can imply.
**Scope:** `desktop/src/main/index.js` (`startTimer`, `get-timer-state`),
`desktop/src/main/session-rules.js` (`completedSecondsForProjectDay`),
`desktop/src/renderer/index-renderer.js` (start handler).

Sibling of [desktop-all-projects-total-resets-on-start.md](desktop-all-projects-total-resets-on-start.md),
which fixed the same class of defect on the *all-projects* line. This one is the *project-scoped*
line, and it survived the offline-first refactor.

## Symptom (owner, 2026-07-30)

First report:

> "when i started a timer on a project it always start from 0, the project total time was 04:45 but
> it started from 0, it should start from the total time of that project"

Then, after the first fix attempt:

> "offline time bug coming, project time 06:46 i started it it shows 01:24 and increase it and
> after a few seconds came near to the 06:46"

## Root cause

### Original defect — hardcoded zero

`startTimer()` zeroed the project's completed base as part of opening the local session:

```js
todayTotalCurrentProject = 0;
```

That value is returned to the renderer as `todayTotal`, where the start handler read:

```js
if (result.todayTotal > 0) todayTotalBase = result.todayTotal;
elapsedSeconds = todayTotalBase;
```

With `todayTotal: 0` the guard never fired, `todayTotalBase` kept whatever was left over (0 for a
freshly selected project), and the display restarted from `00:00:00`. It only recovered when
`applyTotalsFromServerStatus()` ran on the next `/timer/status` tick.

The renderer's intent was always correct — it displays `todayTotalBase + elapsed`, not
session-only. Main was simply feeding it a zero.

### Second defect — the first fix seeded from the wrong source

The initial fix seeded the base from local SQLite (all completed rows for that project today).
That is **not** a proxy for the day's total, and measurement on the reporter's machine showed why:

| Internal Tools | value |
| --- | --- |
| local completed today | 78 s = **01:18** ← what the seed used |
| server `today_total` | 443 s = **07:23** ← what was actually on screen |

Every local row was already synced (`unsynced = 0`). Local SQLite holds only *this device's
un-purged rows* — the 05:00 purge removes confirmed rows, and it knows nothing of manual entries or
work tracked elsewhere. So the display showed ~01:18, then the periodic status tick overwrote it
with the true figure: a visible jump, which is what the second report describes.

## Fix

The seed must match what is already on screen, or Start produces a jump seconds later. It is now
assembled the same way `todayTotalGlobal` already is — server figure plus only the local rows the
server has not seen:

```js
const serverProjectBase = _serverProjectTodayTotals.get(projectId);
todayTotalCurrentProject =
    serverProjectBase != null
        ? serverProjectBase +
          getLocalCompletedSecondsForProjectToday(projectId, { unsyncedOnly: true })
        : getLocalCompletedSecondsForProjectToday(projectId);
```

- `_serverProjectTodayTotals` caches the project-scoped `today_total` from `get-timer-state`,
  captured **only while no timer is running**. Once a timer runs the server figure starts including
  that live entry's elapsed, which would double-count against the ticking display.
- Only **unsynced** local rows are added, so rows the server already counted are not counted twice.
- Both inputs are cached or local, so the start path stays offline by construction — the
  local-first rule that no network call sits on start/stop/switch/idle is preserved.
- Falls back to the full local total when there is no server figure yet (first run, or offline),
  which is still far better than zero.
- The cache is cleared on **both** logout paths, so one account can never seed a timer with
  another's hours.

The renderer now assigns the base unconditionally:

```js
todayTotalBase = result.todayTotal ?? 0;
```

The old `> 0` guard meant a start response of 0 left the previous value in place, so starting on a
project with genuinely no time today could inherit the **previous** project's total. Main now
always returns that project's real base, so 0 is a legitimate answer.

## Tests

`completedSecondsForProjectDay()` in `session-rules.js` (pure, no DB/Electron):

- sums every completed row for the project, synced or not
- ignores other projects
- excludes live rows and earlier days
- a null project id is its own bucket, not a wildcard
- handles a missing / non-array row set
- `unsyncedOnly` skips rows the server already has — the seed path; counting synced rows there
  would double-count against the server total and overstate the day
