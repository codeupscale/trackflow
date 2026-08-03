# Force-quit / dead machine left the session open — and the midnight split billed it

| | |
|---|---|
| **Area** | Desktop agent — termination handling, crash recovery, midnight split |
| **Platform** | All |
| **Severity** | **P0** — produced 24-hour "work days" in reports, attendance and payroll |
| **Reported** | 2026-08-03 (owner, via dev 8: "total showed 63 hours") |
| **Status** | ✅ FIXED (2026-08-03, branch `fix/desktop-idle-gap-billed-and-sync-cadence`) — desktop and server sides both closed |

## Symptom

A developer started the timer and the total showed **63 hours**; stopping and
starting again showed **11 hours**.

## What actually happened (dev DB, `abdul.haseeb+dev@codeupscale.com`)

| entry | started | ended | duration | created on server |
|---|---|---|---|---|
| `019fc65c-173f` | Fri 07-31 15:31 | 07-31 19:00 | 3.47h | Mon 08-03 06:42:31 |
| `019fc65c-1933` | 07-31 19:00 | 08-01 19:00 | **24h** | Mon 08-03 06:42:32 |
| `019fc65c-193c` | 08-01 19:00 | 08-02 19:00 | **24h** | Mon 08-03 06:42:32 |
| `019fc65c-1944` | 08-02 19:00 | 08-03 06:42 | 11.71h | Mon 08-03 06:42:32 |

3.47 + 24 + 24 + 11.71 = **63.18h** — the 63. 19:00 UTC is 00:00 Asia/Karachi, so
the last row is *today's* slice alone = **11.71h** — the 11. Nothing was wrong with
the totals arithmetic: **a session started Friday afternoon was never closed**, and
by Monday it had been carved into per-day rows.

## Root causes

1. **The midnight split was applied to a corpse.** `maybeSplitAtMidnight()` (1s tray
   tick) split any "running" session at every midnight it spanned — by design, so a
   machine asleep Friday→Monday yields one row per day. But that design assumes the
   session is alive. Applied to a session whose machine has been dead for days, it
   manufactures a perfect 24-hour work day per calendar day.
2. **No handler for termination signals.** `SIGTERM` / `SIGINT` / `SIGHUP` — `kill`,
   Ctrl+C, a closing terminal, Activity Monitor's "Quit", Task Manager's "End task",
   OS logout/shutdown — killed the process with no graceful close. Only tray > Quit
   and Cmd/Ctrl+Q ran `before-quit`.
3. **`lastActiveAt` depended on the SERVER.** Every back-dated auto-stop (startup gap,
   sleep gap, idle watchdog, and now the corpse guard) closes the entry at this
   stamp — and it only advanced via `setOnHeartbeatSuccess`, i.e. when the server
   ACKNOWLEDGED a heartbeat. Survivable at a 60s sync cadence; with the new 10-minute
   upload cadence a heartbeat cannot even be accepted until its session exists
   server-side, so the stamp could sit 10+ minutes stale while the user typed. A
   crash would then discard real work, and the corpse guard would read a live
   session as dead.

## Fixes

| Fix | Where |
|---|---|
| **Corpse guard** — a live session with no real input for longer than the idle threshold is CLOSED at the last input instead of being split. Pure, unit-tested `staleLiveSessionDecision()`; fails OPEN (no stamp / no threshold ⇒ never stale) so it can never stop a timer someone is using | `session-rules.js`, `maybeSplitAtMidnight()` |
| **SIGTERM / SIGINT / SIGHUP** routed into `app.quit()`, so every *catchable* termination runs the same graceful close + bounded flush as tray > Quit | `index.js` |
| **`lastActiveAt` stamped locally** from `powerMonitor.getSystemIdleTime()` on the 1s tick (throttled to one write / 30s). No network, no server ack — an offline user is no longer indistinguishable from a corpse | `index.js` |

## What is NOT possible

`SIGKILL` — the macOS **Force Quit** dialog, `kill -9`, a pulled battery, a hard
power cut — runs **no JavaScript at all**, on any OS. Nothing can close the session
"before the kill" in that case; the kernel does not offer the process a chance. What
protects the user is local-first recovery: the row is already durable in SQLite and
is closed at the last real input by `detectAndCloseStaleSessionOnStartup()` on the
next launch, or by the corpse guard if the app returns much later. **No tracked time
is lost, and no dead time is billed** — but the correction only lands when the agent
next runs.

## Server side — a machine that never comes back (done, 2026-08-03)

If the machine is reimaged, stolen or never switched on again, local-first recovery
can never run. The entry would stay open and `TimerService::status()` counts an open
entry's elapsed to *now* (capped at `timer.max_entry_duration`, 24h), so a dashboard
shows a fabricated day for someone who is gone.

**This already had not one but TWO implementations**, which is why it kept happening:

| | window | closed the entry at | verdict |
|---|---|---|---|
| `timer:cleanup-stale` (every 5 min) | 4h | last **heartbeat** ✅ | kept |
| `CloseStaleTimerEntriesJob` (every 30 min) | 5h | **`updated_at`** ❌ | deleted |

`updated_at` moves on every agent push, so that job billed every dead minute between
the user's last input and the agent's last sync. Two mechanisms disagreeing about the
close instant is worse than either alone.

Now a single implementation — `TimeEntrySyncService::closeAbandonedOpenEntries()`,
driven by the 5-minute command, with the window at **60 minutes**
(`timer.abandoned_after_minutes`, env `TIMER_ABANDONED_AFTER_MINUTES`):

- **Liveness** = the most recent of the last heartbeat **and `client_synced_at`**,
  which the sync endpoint stamps on *every* push of the live session including one
  carrying no change. That is what makes a 60-minute window safe: an agent that is
  merely offline — heartbeats queued, arriving hours later — is still visibly alive.
- **Close instant** = the last **heartbeat**, else the entry's own start (a zero-length
  close). Never `now()`, and never `client_synced_at`: that proves the agent was alive,
  not that the user was working.
- Runs under `lockForUpdate()` and re-checks, so a returning agent racing the sweeper
  wins; emits `TimerStopped` after commit so dashboards update; clears the Redis timer
  key so `status()` stops reporting a live timer.
- **Provisional by construction**: `client_revision` is deliberately left untouched, so
  the agent's next push (a higher revision) overrides the server's guess outright —
  the one-writer contract is preserved. Covered by
  `test_the_close_is_provisional_a_returning_agent_still_wins`.

## Manual QA

1. Track, then `kill <pid>` (SIGTERM) → the entry closes at the last input; the total
   does not jump.
2. Track, then **Force Quit** (SIGKILL) → nothing closes immediately (expected);
   relaunch → the entry is closed at the last input, not at relaunch time.
3. Track, sleep the machine overnight, wake it → **one** closed entry ending at last
   night's last input. No 24h rows, and the timer is not running.
4. Track normally across local midnight with the machine awake → the split still
   happens (two rows, contiguous at 00:00 org time).
5. Work offline for 30 minutes → the timer keeps running and is NOT stopped by the
   corpse guard (this is the `lastActiveAt` fix).
