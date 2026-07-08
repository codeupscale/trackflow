# Checkout error after stopping desktop timer ("No open check-in found")

**Status:** ✅ FIXED (2026-07-07, `develop`)

**Scope:** HR check-in/checkout UX + `CheckInService::checkOut()`; web `CheckInCard`, `useCheckOut`.

**Severity:** P1 — employees stop the desktop time tracker at end of day, open **My Attendance**,
click **Check Out**, and get **"No open check-in found"** even though they worked all day.

## Symptom

1. Employee tracks time on the **desktop app** all day (or stops it around 8:30 PM).
2. Opens the web **Attendance** page and clicks **Check Out**.
3. Toast/error: **No open check-in found** (or similar).
4. Often paired with the prior **missing checkout** false-positive on the next day.

## Root cause

**The desktop timer and HR attendance check-in are separate systems.** Starting/stopping the
desktop tracker does **not** create or close an HR `check_in_sessions` row. Checkout only works
when there is an **open** web check-in session.

Common real-world flows that hit the error:

| Flow                                                                          | Why checkout fails                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Desktop only — never tapped **Check In** on web                               | No session exists                                 |
| Checked out at lunch, resumed desktop PM without **Check In again**           | Last session already closed                       |
| Double-click **Check Out** / stale UI after a successful checkout             | Second POST found no open session → confusing 422 |
| Stale **Check Out** button after desktop stop without refetching today status | UI out of sync with server                        |

## Fix

**Backend** (`CheckInService`):

- **Idempotent checkout** — if a session was closed within the last 5 minutes, treat repeat
  checkout as success (double-submit / stale card).
- **Actionable 422 messages** — distinguish "never checked in" vs "already checked out after a
  break" and explicitly state that **stopping the desktop tracker does not check you out**.

**Frontend**:

- `CheckInCard` — amber info banner when the desktop tracker is running but HR check-in is open.
- Refetch `attendance/today` when the desktop timer transitions **running → stopped**.
- On checkout error, invalidate today status so the button state re-syncs.

## Verify

- `tests/Feature/Hr/CheckInTest.php`:
    - `test_checkout_is_idempotent_within_five_minutes`
    - `test_checkout_after_lunch_without_recheck_in_explains_desktop_timer`
    - `test_checkout_without_check_in_mentions_desktop_timer`

## Key files

- `backend/app/Services/CheckInService.php` — `checkoutWhenNoOpenSession()`, idempotency window
- `web/src/components/hr/CheckInCard.tsx` — desktop-tracker banner + timer-stop refetch
- `web/src/hooks/hr/use-check-in.ts` — checkout error invalidation
