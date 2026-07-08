# Missing checkout shown after user checked out at end of day

**Status:** ✅ FIXED (2026-07-07, `develop`)

**Scope:** HR check-in/checkout — `CheckInService`, `AttendanceService::serializeRecord()`, nightly
`CloseStaleCheckInsJob` / `autoCloseStaleCheckIns()`.

**Severity:** P1 — employees see a "Missing checkout" badge on My Attendance / Team Attendance the
day after they clicked **Check Out** around the official off time (~8:30 PM).

## Symptom

1. Employee checks in during the day and clicks **Check Out** near 8:30 PM (org policy off time).
2. UI shows "Checked out successfully" and the day total looks correct.
3. **Next morning** the attendance row for that day shows **Missing checkout** (and managers see
   it in team views / reports).

## Root cause

Two related defects:

### 1. `missing_checkout` never cleared on successful checkout

`recomputeRecordRollups()` updated `check_out_at` / `worked_seconds` when a session closed but
**did not reset** `missing_checkout` or the `check_in_flags.auto_closed` marker. If the nightly
backstop (`autoCloseStaleCheckIns` at 03:00 UTC) had already flagged the row, a later checkout
(left the session open overnight) closed the session but left `missing_checkout = true` in the DB.

### 2. API/list rendered the raw DB flag even when all sessions were closed

`serializeRecord()` and `getTodayStatus()` exposed `missing_checkout` directly from the column.
After a successful checkout (all sessions closed) a stale flag still drove the red badge.

The backstop job itself was correct — it only flags past days with an **open** session. The bug was
stale flags surviving after checkout, plus no self-heal for rows already fully closed.

## Fix

- `CheckInService::recomputeRecordRollups()` — when no open sessions remain, set
  `missing_checkout = false` and remove `auto_closed` from `check_in_flags`.
- `CheckInService::effectiveMissingCheckout()` — API only surfaces the flag while an open session
  still exists.
- `CheckInService::healStaleMissingCheckoutFlags()` — run at the start of each backstop pass to
  clear erroneous flags on production data.
- `AttendanceService::serializeRecord()` — same effective rule for attendance list/team rows.

## Verify

- `tests/Feature/Hr/CheckInTest.php`:
  - `test_evening_checkout_survives_next_day_backstop`
  - `test_checkout_clears_missing_checkout_after_backstop`
  - `test_backstop_self_heals_stale_missing_checkout_when_sessions_closed`

## Key files

- `backend/app/Services/CheckInService.php` — `recomputeRecordRollups()`, `autoCloseStaleCheckIns()`,
  `effectiveMissingCheckout()`, `healStaleMissingCheckoutFlags()`
- `backend/app/Services/AttendanceService.php` — `serializeRecord()`
- `backend/app/Jobs/CloseStaleCheckInsJob.php` — scheduled `dailyAt('03:00')` in prod
