# Check-in: 11:00 auto check-in floor + midnight force-checkout of open sessions

**Area:** Backend HR check-in / attendance (`CheckInService`, scheduler)
**Severity:** P2 (behaviour change / data-hygiene)
**Status:** ✅ IMPLEMENTED (2026-07-23, owner request) — in working tree, not yet committed
**Type:** Feature change (two related owner requests), not a defect.

Two attendance changes, both scoped strictly by `organization_id` and Redis-free-testable
(the Laravel scheduler is prod-only; the service methods are exercised directly).

---

## Feature A — suppress auto check-in before 11:00 AM (org-local)

### What
`CheckInService::autoCheckInFromTracking(User, Carbon $startedAt)` auto-creates an attendance
check-in when the desktop starts a timer (gated by org setting `auto_check_in_on_track`).
Previously an early timer start (e.g. 09:00) still created a check-in. Now, if the timer start
converted to the org policy timezone is **before the `auto_check_in_min_time` floor (org-local
wall clock, default `11:00:00`)**, the method is a side-effect-free no-op (`return null`), the
same as the other skip paths. At/after the floor (boundary inclusive) behaviour is unchanged.

### How
- New org setting `auto_check_in_min_time`, stored on `organizations.settings` alongside the
  existing `auto_check_in_on_track` flag, resolved via `getSetting('auto_check_in_min_time',
  '11:00:00')`. Default `11:00` works out-of-the-box for the PKT orgs with no migration.
- Guard added right after the feature-flag check, before the DB transaction, in
  `CheckInService::autoCheckInFromTracking()`. The floor is rebuilt per-date in the org tz via
  `Carbon::parse("{$date} {$minTime}", $tz)` so DST is handled like the other policy times.

### Files
- `backend/app/Services/CheckInService.php` — `autoCheckInFromTracking()` guard (approx. the
  block right after `$lateAt = …`).

---

## Feature B — midnight (00:00 PKT) force-checkout of open sessions

### What
At the org-local midnight, force a checkout on every OPEN `check_in_sessions` row left over from
a day that has already ended. **Distinct from `autoCloseStaleCheckIns()` (03:00 backstop), which
only FLAGS `missing_checkout` and leaves the session open** — here we actually stamp a real
`check_out_at` so `worked_seconds`/overtime finalise.

### Checkout timestamp (owner decision) — "last tracked activity"
The stamped checkout is the user's **last tracked activity** on that session's org-local day:
`MAX` of two signals, whichever is later —
1. the last CLOSED `type='tracked'` `time_entries.ended_at` that day (the common case), and
2. the last `activity_logs.logged_at` heartbeat that day.

**Why include the heartbeat, not just `MAX(ended_at)`:** a heartbeat is the finest-grained record
of real work AND the only signal available when a tracked entry is left running (null `ended_at`)
— an open entry then yields a truthful last-seen instant instead of nothing. Both are bounded to
the org-local day and taken as an absolute-instant max.

Fallbacks, in order: if there is no usable activity, or it is `<=` the session's `check_in_at`,
fall back to the policy `checkout_time` for that date; if that too is `<=` `check_in_at` (a
degenerate very-late-evening check-in), stamp `check_in_at + 1s`. The checkout is therefore
**always strictly after** the check-in.

### Post-close bookkeeping
After stamping, `recomputeRecordRollups()` recomputes `worked_seconds` / `check_out_at` /
early-checkout / overtime. Because every session is now closed, recompute clears
`missing_checkout`; we then **re-assert** `missing_checkout = true` + `check_in_flags.auto_closed
= true` (regularizable) and add a durable `check_in_flags.auto_checked_out = true` marker — unlike
`auto_closed`, this marker is never cleared by the 03:00 close-stale heal, so the fabrication stays
auditable even after the secondary backstop runs.

### Guards
- Only records whose org-local `date` is `< today` (org-local) are touched — a current-day session
  is never closed early (same date guard as `autoCloseStaleCheckIns`).
- Per-record `DB::transaction` + `lockForUpdate` on the attendance record, then re-fetch open
  sessions under lock (record → session lock order, matching `checkOut()`); if a manual checkout
  already closed them, it returns 0 — never double-closes.
- All queries `withoutGlobalScopes()` + explicit `organization_id` (system context, no auth user).

### Scheduling
`ForceCheckOutOpenSessionsJob` (mirrors `CloseStaleCheckInsJob`: `$tries=3`, `$timeout=300`,
`backoff=[60,120,300]`, `failed()`), dispatched per-org from a `routes/console.php` schedule at
`dailyAt('19:00')` UTC = **00:00 Asia/Karachi**, named `force-checkout-open-sessions`. The 03:00
`close-stale-check-ins` job is left in place as a harmless secondary backstop.

### Files
- `backend/app/Services/CheckInService.php` — `autoCheckOutOpenSessions()`,
  `forceCloseRecordOpenSessions()`, `lastTrackedActivityInstant()`,
  `resolveForcedCheckoutInstant()`; imports `ActivityLog`, `TimeEntry`.
- `backend/app/Jobs/ForceCheckOutOpenSessionsJob.php` — new job.
- `backend/routes/console.php` — new `force-checkout-open-sessions` schedule.

---

## Tests
- `backend/tests/Feature/Hr/AutoCheckInOnTrackTest.php` — Feature A: before-floor skip (incl. one
  minute before), boundary at exactly 11:00 records, before-window-but-after-floor records,
  configurable threshold, and tz-correctness (America/New_York). One pre-existing test renamed
  (`test_start_before_check_in_window_but_after_min_time_is_recorded`) — the old "09:00 early start
  is recorded" premise is intentionally reversed by the new floor.
- `backend/tests/Feature/Hr/ForceCheckOutOpenSessionsTest.php` (new) — Feature B: checkout at last
  tracked activity, heartbeat when entry still open, fallback to `checkout_time` (no activity /
  activity before check-in), overtime recompute, degenerate `+1s` guard, never closes current-day,
  idempotent/no-double-close, skips already-closed, multi-session (only open one closed),
  cross-org isolation.

Run: `./vendor/bin/phpunit -c phpunit.local.xml --filter 'AutoCheckInOnTrackTest|ForceCheckOutOpenSessionsTest'`
→ **24 passed, 81 assertions** (2026-07-23). `CheckInTest` still green (37 passed). The 2 known
pre-existing `TimerServiceTest` failures are unrelated.

## Multi-tenancy
Every new query uses `withoutGlobalScopes()` with an explicit `organization_id`; the last-activity
lookups filter `organization_id` + `user_id`; the job is dispatched per-org; the schedule iterates
orgs via `chunkById`. `test_org_isolation` proves org A's force-checkout leaves org B's open
session untouched.
