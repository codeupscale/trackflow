# A superseded session was closed at sync time, not at the last real input

| | |
|---|---|
| **Area** | Backend — `TimeEntrySyncService::closeOtherOpenEntries()` |
| **Platform** | All (server-side; no desktop release required) |
| **Severity** | **P0** — fabricated ~150 hours on a single account, clamped into 24-hour "work days" |
| **Reported** | 2026-08-13 (owner: "users are seeing 690 hours") |
| **Status** | ✅ FIXED (2026-08-13, branch `fix/desktop-orphan-backlog-closed-at-now`) |

## Symptom

Employees' totals were wildly inflated — reports showing hundreds of hours more than
anyone had worked. On one account, ten separate days each appeared as a **24.00-hour**
entry.

## Evidence (prod, `rohail.butt+v1@codeupscale.com`)

| started (UTC) | last heartbeat | `ended_at` written | billed |
|---|---|---|---|
| 2026-08-12 06:48 | 2026-08-12 **15:35** | 2026-08-13 **07:39** | **24.00h** |
| 2026-08-11 06:35 | 2026-08-11 **15:28** | 2026-08-13 **07:41** | **24.00h** |
| 2026-08-10 06:40 | 2026-08-10 **14:20** | 2026-08-13 **07:41** | **24.00h** |

Each row is a real workday: a normal ~06:40 UTC start, 600–950 heartbeats, input
stopping around 15:30 UTC (~20:30 PKT). Real work ≈ 9h. Billed: 24h — the cap, not a
measurement. Every `ended_at` lands on the morning of **08-13**, within ~2 minutes of the
others, in reverse order of `started_at`: one loop, closing a backlog.

## Root cause

`closeOtherOpenEntries()` picked its close instant as:

```php
$endedAt = $lastHeartbeat ? Carbon::parse($lastHeartbeat) : ($entry->client_synced_at ?? $entry->started_at);
```

`client_synced_at` is **liveness evidence, not work evidence** — it records that the agent
process was alive, not that anyone was at the keyboard. Its sibling `closeIfAbandoned()`
states this rule explicitly and obeys it:

> Close instant = the last evidence of WORK. `client_synced_at` proves the agent was
> alive, not that the user was at the keyboard, so it is never the close point.

The two methods disagreed, and the wrong one ran on this path.

**Why the heartbeat branch didn't save it.** The sync protocol pushes SESSIONS BEFORE the
offline queue — mandatory, because screenshots and heartbeats FK to `time_entries.id`,
which only exists once the owning session has synced. So when a returning agent flushes a
backlog, its superseded entries are evaluated here while their heartbeats are **still
queued client-side**. `$lastHeartbeat` is null at that instant, the close falls through to
`client_synced_at` ≈ now, and every dead hour since the user actually stopped is billed.
The heartbeats then arrive moments later — which is why the rows look, after the fact, as
though they had heartbeat evidence available all along. That ordering is what hid this.

The 24h figure is the server's duration clamp, so the damage is bounded per row but
compounds per orphaned session.

## Fix

```php
$endedAt = $lastHeartbeat ? Carbon::parse($lastHeartbeat) : $entry->started_at->copy();
```

`client_synced_at` is removed as a candidate close instant, matching `closeIfAbandoned()`.
The failure mode becomes "lose an unproven session" (a zero-length close, billing nothing)
rather than "invent a day of work". Late heartbeats still land and re-score the entry.

Regression tests in `backend/tests/Feature/Timer/TimerSessionSyncTest.php`:

- `test_superseded_entry_with_no_visible_heartbeat_closes_at_its_start_not_now` — verified
  to FAIL against the old line, closing at now (`07-30`) instead of the start (`07-27`),
  reproducing the exact 3-day fabrication.
- `test_superseded_entry_closes_at_its_last_heartbeat_when_one_exists` — guards against
  over-correcting: with real heartbeats the close still lands on the last one.

Full timer suite: 175 tests, 548 assertions, green.

## Not the cause (ruled out during investigation)

- **`closeIfAbandoned()` / the 60-minute backstop** — it already closes at
  `$lastActivityAt ?? $entry->started_at` and never touches `client_revision`. Provably
  could not have written these values.
- **The desktop corpse guard** (`staleLiveSessionDecision`) — real, but a different path.
  Note it is reachable only via `maybeSplitAtMidnight()` on the ONE session
  `WorkSessionStore.getLive()` returns (`LIMIT 1`), so a backlog of orphaned open rows is
  structurally invisible to it. Not the cause here, but worth a follow-up: nothing
  client-side can close an orphan that is not the newest open row.
- **Duplicate rows / the retired 12h cap** — a separate, older inflation class, still
  present as unrepaired historic data. See below.

## Historic data is NOT repaired by this fix

This stops new fabrication; it does not correct rows already written. A read-only dry run
is in `scripts/prod-repair-inflated-time-entries-dryrun.sql`. Measured 2026-08-13:

| | Hours |
|---|---|
| Before | 11,529.6 |
| − duplicate rows (125 rows / 79 groups) | 491.0 |
| − time billed past last real input (131 entries) | 579.6 |
| **After** | **10,459.1** (−9.3%) |

**The evidence horizon is load-bearing.** `activity_logs` only begins **2026-05-15**;
1,427 entries predate it and have no heartbeats because collection had not started, not
because no work happened. Any repair keyed on "no heartbeat ⇒ no work" MUST exclude them
or it silently zeroes legitimate history.
