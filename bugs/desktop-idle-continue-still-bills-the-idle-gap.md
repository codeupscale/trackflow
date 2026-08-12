# "Continue tracking" still bills the whole idle gap

| | |
|---|---|
| **Area** | Desktop agent — idle discard split (`handleIdleAction` → `WorkSessionStore.closeAndReopen`) |
| **Platform** | All |
| **Severity** | **P0** — idle minutes were billed as work on every idle cycle |
| **Reported** | 2026-07-31 (owner, after testing the desktop release) |
| **Status** | ✅ FIXED (2026-08-03, branch `fix/desktop-idle-gap-billed-and-sync-cadence`) |

## Symptom

The idle alert appears. The user clicks **"Continue tracking"**. The idle period is
then **added to the day's total** anyway — exactly the thing the prompt exists to
prevent.

## Evidence (dev DB, real session)

`abdul.haseeb+dev@codeupscale.com`, 2026-07-31, org timezone Asia/Karachi:

| entry | started | ended | duration |
|---|---|---|---|
| `019fb882` | 14:09:41 | 14:10:35 | 53s |
| `019fb88e` | **14:10:35** | 14:28:29 | **1074s** |

Heartbeats (`activity_logs`) stop at **14:20:14** and resume at **14:23:55** — the
activity monitor is stopped the moment idle is detected and restarted when the user
answers, so that hole *is* the idle period. Last real input was ~14:10:35, idle was
detected ~10 min later at 14:20:14, and the prompt was answered at 14:23:24 (the
`updated_at` of the first row and `created_at` of the second, to the second).

So the split fired at the **correct** instant — `019fb882` ends exactly at
idle-start — and then the successor **opened at that same instant** instead of at
the resume. The ~13 minutes of idle sat inside `019fb88e` and were billed.

## Root cause

`WorkSessionStore.closeAndReopen(id, atIso)` closed at `atIso` and opened the
successor at `atIso` — deliberately contiguous, which is exactly right for a
**project switch** and the **midnight split** (no instant may belong to no session).

The idle discard is the one case that must leave a hole, and it called the same
helper with a single instant. `handleIdleAction` even computed `resumeIso`… and
never passed it. The gap was therefore never discarded — only moved from the old
row into the new one.

```js
const resumeIso = new Date().toISOString();   // computed
const next = splitLocalSession(prevLocalId, idleStartIso, projectId, null);  // …and dropped
```

### Why the tests passed anyway

`desktop/test/idle-discard-split.test.js` asserts `reopenedAt === resumeMs` — but
against a **local mirror** of what `handleIdleAction` is supposed to do, because
`index.js` cannot be imported under Jest (Electron + better-sqlite3). The mirror was
right and the wiring was wrong, and nothing compared the two.

## Fix

- `closeAndReopen(id, atIso, { projectId, taskId, reopenAtIso })` — `reopenAtIso`
  defaults to `atIso` (project switch / midnight split unchanged) and throws if it
  is earlier than the close instant.
- `splitLocalSession()` forwards it; the idle-discard call site passes `resumeIso`.
- Post-fix shape: closed row ends at idle-start, new row starts at the resume, and
  the idle span belongs to **no** session — which is what `preIdleSeconds`
  (measured to idle-START) already assumed when crediting the day total.
- `idle-discard-split.test.js` gains a **wiring** describe block that checks the real
  call site against the mirror, so a mirror can never again pass while the shipped
  code does something else.

## Manual QA

1. Track, go idle past the threshold, wait a few minutes, click **Continue tracking**.
   The day total must be unchanged by the wait — it should equal work *before* going
   idle plus work *after* resuming.
2. The server must show two entries with a **gap** equal to the idle period
   (previously they were contiguous).
3. Project switch and the midnight split must stay **contiguous** — no gap.
4. "Stop timer" from the alert still closes at idle-start (unchanged).
