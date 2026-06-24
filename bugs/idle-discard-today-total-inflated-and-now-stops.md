# Idle "Discard" inflated the today total, then auto-resumed (now stops the timer)

**Status:** ✅ FIXED (2026-06-24, `develop`)

**Scope:** Desktop agent idle handling — today-total accumulation + Discard button product
behavior. Backend/web are correct (server splits the entry properly).

**Severity:** P1 — desktop over-counts after Discard and misleads the user; the Discard action
also did not stop tracking as users expect.

## Symptom (reported)

1. Timer paused/idle shown at **16:02**; user waited out the idle window + ~4 more min, then
   pressed **Discard**.
2. The timer **kept counting** (auto-resumed on a new entry) instead of stopping.
3. Desktop and portal totals diverged and "changed many times"; desktop total climbed to
   **~20 min** (the full wall-clock elapsed) when it should have stayed at the pre-idle ~16 min.

## Root cause

Two separate issues in `handleIdleAction()` ([desktop/src/main/index.js](../desktop/src/main/index.js)).

**1. Today-total inflation ("FIX D5" block).** After the split, the displayed running total is
`todayTotalCurrentProject + liveElapsed`, where the new live entry counts from **idle-end**
(`now − idleEndedAt`). The D5 block accumulated the pre-idle work measured to **idle-END**:

```js
// BEFORE (buggy)
const preIdleSeconds = Math.floor((idleEndedAt - new Date(currentEntry.started_at).getTime()) / 1000);
```

That spans `started_at → idle_END`, i.e. pre-idle work **plus the discarded idle gap**. The
live entry then adds `now − idle_END` on top, so the total becomes `now − started_at` — the
full wall-clock elapsed **including the idle the user just discarded** (~20 min vs ~16 min).
The server, by contrast, closes the original tracked entry at **idle-START** and logs the gap
as an audit-only `idle` entry, so the portal stays correct. This is distinct from
[idle-reassign-desktop-time-inflated.md](idle-reassign-desktop-time-inflated.md), which fixed
the `_cachedStartedAtMs` / local `timer_sessions` re-anchor — a different code path.

**2. Discard resumed instead of stopping.** Discard shared the reassign code path
(split → re-anchor → keep tracking, Hubstaff-style). Users expected Discard to remove the idle
time **and stop** tracking. A separate "Stop Timer" button already did exactly that, so the two
actions were confusing/redundant.

## Fix

**1.** D5 now measures pre-idle work to **idle-START**, matching the server split and the local
session-stop a few lines below:

```js
// AFTER
const preIdleSeconds = Math.floor((effectiveIdleStartedAt - new Date(currentEntry.started_at).getTime()) / 1000);
```

This still applies to **Reassign** and to the `keep_idle_time:"never"` auto-discard, both of
which resume tracking.

**2.** The **Discard Idle Time** button now sends the existing **`"stop"`** action (discard idle
→ stop timer → show correct total). The internal `"discard"` action is left unchanged so the
`keep_idle_time:"never"` policy keeps tracking. The redundant **Stop Timer** button (and its `S`
shortcut) was removed from the idle popup. Idle popup is now 3 actions: **Keep** (count idle,
resume), **Reassign** (move idle to project, resume), **Discard** (remove idle, **stop**).

## Verify

- `cd desktop && npm test` — full suite green (489/489). Added 3 regression tests in
  `timer-sync-invariants.test.js` pinning the discard today-total math (display excludes the
  idle gap; the old idle-END formula would inflate by exactly the gap). Updated
  `e2e/idle-alert.test.js` (Discard → `stop`; removed Stop-button cases).
- Manual (`mirza.blade@yopmail.com`, dev): track ~16 min → go idle → wait in the dialog →
  **Discard** → timer **stops**, main window returns to Start, desktop total == portal total
  (~16 min, idle gone).

## Key files

- `desktop/src/main/index.js` — `handleIdleAction()` D5 today-total (idle-START boundary).
- `desktop/src/renderer/idle-alert.html` / `idle-alert.js` — Discard → `stop`; Stop button removed.
- `desktop/test/timer-sync-invariants.test.js`, `desktop/test/e2e/idle-alert.test.js` — tests.
