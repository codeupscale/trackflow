# Offline-first time tracking — architectural refactor

**Area:** Desktop agent + Laravel timer API
**Severity:** P1 (root cause of a long tail of data-loss defects)
**Status:** ✅ FIXED (2026-07-30) — branch `refactor/offline-first-time-sync`

---

## Symptom class

Not a single defect. This report covers the shared root cause behind a family of them:

| Report                                                | Symptom                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `desktop-signout-quit-unsynced-time-lost.md`          | Signing out offline permanently destroyed tracked time         |
| `desktop-idle-alert-timer-resumes-on-reconnect.md`    | Timer restarted itself on reconnect, behind an open idle alert |
| `idle-reassign-offline-reconcile-duplicate.md`        | Reconnect produced a second, overlapping entry                 |
| `offline-screenshots-rejected-after-entry-closed.md`  | Screenshots from an offline session were dropped               |
| `desktop-all-projects-total-resets-on-start.md`       | Totals collapsed or reset around start/stop                    |

Each was fixed individually. They kept recurring in new shapes because the fixes
treated symptoms of a structural problem.

## Root cause

**Two writers owned the same time entry.**

The desktop wrote SQLite *and then* called `POST /timer/start`; stop did the same;
idle decisions called `POST /timer/idle`, which mutated entries **server-side**. Any of
those calls could fail, so the agent grew a reconciliation layer to repair the
divergence afterwards — `reconcileTimerState()` (~290 lines of interleaved special
cases), `syncOpenTimerFromServerStatus()`, `reanchorFromOfflineIdle()`,
`retryIdlePauseIfUnsynced()`, plus `_startTimerInProgress` /
`_stopTimerInProgress` / `_timerStateMutationInProgress` / `isIdlePauseAuthoritative()`
interlocks whose only purpose was to stop those repairs racing each other.

Reconciliation cannot be made correct in general: when two writers disagree there is no
information left to decide which is right. Every fix narrowed one race and left the
next one reachable.

Two hard limits made it worse:

- `MAX_PAST_SKEW = 86400` — a timestamp older than **24 h was rejected outright**. A
  laptop that tracked offline over a long weekend had *every* session refused on
  reconnect. The product's core promise was unkeepable by construction.
- `MAX_ENTRY_DURATION = 43200` — silently **clamped** anything over 12 h.

## Fix

Local SQLite is the sole source of truth; the server is a replica fed by a one-way
push. There is exactly one writer, so there is nothing to reconcile.

**Desktop**

- Timer start / stop / project switch / idle decisions write SQLite and return. **No
  network call is on any of those paths.**
- `timer_sessions` evolved **in place** — its existing `idempotency_key` already held a
  `crypto.randomUUID()`, which is precisely the key the server upserts on, so no new
  table and no data copy were needed. Added `revision` / `synced_revision` /
  `confirmed_at`; a row is dirty iff `synced_revision <> revision`.
- `session-sync-worker.js`: health gate → batched push → confirm → **then** flush the
  offline queue. Ordering is mandatory: screenshots and heartbeats FK to
  `time_entries.id`, which exists only once the owning session has synced.
- **Midnight split** at 00:00 in the *organization's* timezone (new `timezone` field in
  `GET /agent/config`), so no entry spans two calendar days and daily rollups stay
  exact. Loops over boundaries — a machine asleep Friday→Monday yields one row per day.
- **05:00 purge** deletes only rows that are closed, confirmed, and aged past a 24 h
  grace. Sleep-safe boundary comparison rather than a `setTimeout` a sleeping laptop
  would skip.
- Deleted ~1,200 lines of reconciliation and its mutexes.

**Backend**

- `POST /timer/sessions/sync` + `TimeEntrySyncService`: idempotent upsert keyed on
  `(organization_id, idempotency_key)`, ordered closed-before-open within a batch so an
  offline project switch cannot collide on `idx_one_active_timer_per_user`.
- `client_revision` is the sole ordering authority — a replay or out-of-order arrival is
  a no-op. Not wall-clock time, which cannot be trusted from a client.
- `POST /timer/{start,stop,switch,pause,resume,idle}` **deleted**. Force-upgrade via
  `TIMER_MIN_AGENT_VERSION`.
- Caps to config: `max_entry_duration` 12 h→24 h, `max_past_skew` 24 h→**30 d**.
  `ScreenshotController`'s backfill horizon now tracks `max_past_skew` — a narrower
  window accepts the entry and then permanently 422s its evidence.
- `client_synced_at` is the new liveness signal. An open entry is no longer evidence of
  a dead agent (it may be tracking offline), so the login-time stale-close and
  `CleanupStaleEntries` gate on it, and an unchanged push of the live session still
  refreshes it.

### Invariants that now hold structurally

- Tracked time is never deleted before the server confirms it — the purge statement
  cannot reach a live, dirty, or unconfirmed row.
- A rejected session is **kept** locally. A rejection is never a licence to delete work.
- Confirmation records the revision **sent**, not the row's current revision, so a stop
  landing mid-flight leaves the row dirty rather than falsely confirmed.
- Sign-out keeps every unconfirmed row for the signed-in user.

## Latent P0 found while verifying

`TimerStarted` / `TimerStopped` implement `ShouldBroadcastNow`, so dispatching them
talks to Reverb **synchronously over HTTP**. They were being dispatched *inside* the
sync transaction: with Reverb unreachable the dispatch threw, the transaction rolled
back, and the entire sync failed with `server_error`.

**In production a Reverb restart would have silently blocked all tracked time from
uploading** — the exact failure this architecture exists to prevent, reintroduced by the
implementation.

The unit suite could not catch it: the test environment does not really broadcast. It
surfaced only when the real store and worker were run against a live server. Events are
now queued and dispatched **after commit**, each isolated, and there is a regression
test (`test_a_broadcast_failure_never_loses_the_session`) that makes the listener throw.

## Known consequences

- **Idle-credit policy is no longer enforceable server-side.** The old `/timer/idle`
  endpoint could refuse `keep`/`reassign` (owner policy, 2026-07-16) because it
  understood idle semantics. The sync endpoint receives opaque sessions and cannot tell
  "idle time relabelled as work" from ordinary tracked time. The desktop only offers
  discard/stop, but a hand-crafted request with a valid token could submit anything.
  Re-establishing a server-side wall would require the agent to report idle gaps as
  metadata — deliberately out of scope here.
- **The elapsed counter resets at midnight**, because the current session genuinely
  restarts. The day's total resets at the same moment, so the two agree. Worth a release
  note.
- Manual time entries are untouched; two-way sync for them remains future work.

## Verification

- Backend `739` tests, desktop `689` tests.
- `TimerSessionSyncTest` (22): create, idempotent replay, stale-revision no-op,
  open→closed, extend-a-cleanup-closed-entry, backward `ended_at` for idle discard,
  unassigned project degrades to null, cross-org uuid rejection, Redis maintained for
  `/timer/status`, broadcast-failure isolation.
- `session-rules.test.js` (49): DST spring-forward/fall-back, multi-day split, and the
  contiguity invariant — pieces sum to the whole, none lost or double-counted.
- End-to-end against a live server with real SQLite: track offline → reconnect → replay
  → stop → idle-discard → purge, with local and server totals matching exactly.

## Rollout

Deploy the **backend first** (endpoint live, `TIMER_MIN_AGENT_VERSION` still empty) →
release the desktop build → confirm adoption via agent-version telemetry → **only then**
set `TIMER_MIN_AGENT_VERSION`. Setting it before the build has rolled out locks every
user out of tracking.
