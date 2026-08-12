# The web dashboard kept counting a session that had already ended

| | |
|---|---|
| **Area** | `TimerService::status()` / `todayTotal()`, `processHeartbeat()`, web timer store + header widget |
| **Platform** | All |
| **Severity** | P1 — inflated dashboard time (up to a full upload interval) + mis-attributed activity scores |
| **Reported** | 2026-08-10 (owner: "the web time is constantly increasing why it is not updating after 10 minutes?") |
| **Status** | ✅ FIXED (2026-08-10) |

## Symptom

The desktop showed **00:11:16**. At the same instant the web header showed
**28:57** and "Today's Hours" showed **0h 29m**, climbing a second at a time.

## Evidence (dev DB, real session, UTC)

| entry | started | ended | duration | rev | server learned at |
|---|---|---|---|---|---|
| `019febb3` | 12:33:38 | 12:37:16 | 3m38s | 2 | 13:03:28 |
| `019febc5` | 12:54:57 | OPEN | — | 1 | 13:03:28 |

The 17m41s hole between the two rows is the idle period — correctly belonging to no
session. The screenshot was taken at 13:02:36, i.e. **52 seconds before** the agent's
next batch push landed, so the server still held `019febb3` open since 12:33:38.

Both figures were then internally consistent:

- web: `13:02:36 − 12:33:38` = **28:58**
- desktop: 3m38s closed + 7m39s live since 12:54:57 = **11:17**

## Root cause 1 — the server extrapolates an open entry to `now()`

`computeOpenEntryElapsed()` was `now() − started_at`, capped only at 24h. With the
desktop owning tracked time locally and uploading on a 10-minute batch, the server's
open entry is routinely a stale replica of state the agent has already changed. Counting
it to `now()` does not merely lag — it INVENTS time and grows it every second:

- after an idle discard, the whole gap the agent already dropped (this report)
- after **Stop**, up to a full cadence of "still tracking"
- after a force-quit or a dead machine, until the 60-minute abandoned backstop

The web faithfully rendered that: `timer-store.tick()` counts `now − started_at` every
second from the server's open entry.

## Root cause 2 — heartbeats landed on the wrong session

Found while verifying the fix, and the reason the first fix alone did nothing here:

```
entry 019febb3  start 12:33:38  end 12:37:16  | heartbeats: 25  first 12:43:39  last 13:03:28
entry 019febc5  start 12:54:57  end OPEN      | heartbeats: 27  first 13:03:58  last 13:16:58
```

`processHeartbeat()` attached every heartbeat to whatever entry the **server's Redis
pointer** held. That pointer only moves when the agent pushes, so for 26 minutes after
`019febb3` was closed locally it kept collecting heartbeats — logs spanning an idle gap
and nine minutes of its successor's work. Two consequences:

1. `computeFinalActivityScore()` finalises a closed entry from activity that is not its
   own, and the successor loses its first minutes of activity data.
2. Those fresh logs made the stale entry look **alive**, defeating any liveness check.

## Fix

**Attribution.** The heartbeat now carries `session_uuid` — the client-generated
`idempotency_key` the sync endpoint upserts on — and the server resolves the entry by
it, scoped to the caller. A heartbeat for a session the server has not received yet is
REFUSED; the agent queues it, and the offline path resolves the real entry id once the
session syncs, exactly as offline-captured heartbeats already do. Agents that send no
uuid keep the old Redis-pointer behaviour, so the backend ships first and no desktop is
broken by the rollout.

**Clamp.** `computeOpenEntryElapsed()` stops measuring at `liveAsOf()` — the most recent
of `client_synced_at` and the entry's last heartbeat — once that is older than
`timer.live_elapsed_grace_minutes` (default 3: above the agent's 30s heartbeat cadence,
well under the 10-minute upload interval, far under `abandoned_after_minutes`).
`client_synced_at` is checked first because it is a column on the row; the heartbeat
lookup only runs when that is already stale, so the healthy path costs no extra query.
`status()` now returns `live_as_of` and `elapsed_is_stale`.

**Web.** `tick()` refuses to advance while `elapsed_is_stale` — ticking on from
`started_at` would re-invent precisely the time the server declined to claim. The header
shows `… · as of HH:MM`, drops the pulsing "live" dot and greys the figure, because a
silently frozen counter reads exactly like a running one between ticks.

## Round 2 — the first fix was not enough (same day)

Verified against the live dev stack and it still read wrong: desktop 18:55, dashboard
29:51 "as of 08:00 pm". Two things were wrong with the clamp as first written.

**It trusted the wrong signal.** `client_synced_at` says the agent PROCESS is up, not
that anyone is working — and it keeps advancing on the 10-minute batch throughout an
idle period. The session whose user stopped at 14:49:14 was credited all the way to the
15:00:00 push. A bare heartbeat is no better: the agent keeps sending them with zero
counters for the entire idle-threshold window (nine minutes, here) before the prompt
appears. `liveAsOf()` now takes the last heartbeat carrying actual INPUT, and the grace
is the org's own `idle_timeout` + 1 minute — the product's own definition of "still
working", and the moment the desktop itself stops accruing. On the measured session that
yields 14:49:20 − 14:30:19 = 19:01, against the desktop's 18:55.

**Freezing was never going to be enough on its own.** After "Continue tracking" the
dashboard read 41:21 against the desktop's 20:09, because the server was still holding
the abandoned session — the boundary that ended it at 14:49 had not been uploaded. A
frozen figure is honest; only telling the server makes it right. So the four instants
at which a boundary moves — start, stop, idle-resolve, project-switch — now push
immediately (`pushSessionBoundary()`), amending the 2026-08-03 periodic-only decision on
the owner's instruction. Bulk data still rides the 10-minute batch and freshness-only
triggers stay banned; `sync-cadence.test.js` enforces both halves.

The clamp remains the safety net for the cases a push cannot cover: a crash, a
force-quit, a dead machine, an offline stretch.

## Regression tests

- `backend/tests/Feature/Timer/LiveElapsedClampTest.php` — a live agent still counts to
  now; a quiet one freezes at its last heartbeat; **the frozen figure does not grow with
  the wall clock**; a sync push alone counts as proof of life; today-totals stop
  inflating too.
- `backend/tests/Feature/Timer/HeartbeatSessionAttributionTest.php` — a heartbeat for an
  unsynced session never lands on the stale entry; closed sessions and other users' uuids
  are refused; uuid-less agents still work; the stale entry stops looking alive.

## Related

- `bugs/desktop-idle-continue-deducts-pre-idle-time-from-total.md` — the desktop-side
  mirror of the same "server total vs local truth" problem
- `bugs/offline-first-time-sync-refactor.md` — the one-writer contract and the cadence
