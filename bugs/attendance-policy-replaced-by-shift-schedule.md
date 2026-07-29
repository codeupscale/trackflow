# Check-in windows moved from per-org attendance_policy to per-user shifts

**Status:** ✅ IMPLEMENTED (2026-07-24, owner request; in working tree, uncommitted)
**Severity:** Feature / architecture change — production check-in engine
**Scope:** Backend (CheckInService, AttendanceService, migrations, routes), Web (settings/nav/shift form), tests

## What changed

Previously one `attendance_policies` row per org defined the check-in window for
everyone: `check_in_time` (11:30), `late_threshold` (11:45), `checkout_time` (20:30),
`timezone` (Asia/Karachi), `allow_early_check_in`. That table is **removed**; each user's
window now comes from their assigned **shift** so an org can run e.g. a Morning and an
Evening shift with different hours.

### Mapping
- `check_in_time`  → `shift.start_time`
- `late_threshold` → `shift.start_time + shift.grace_period_minutes` (derived)
- `checkout_time`  → `shift.end_time`
- `timezone`       → `shift.timezone`
- `allow_early_check_in` → new `shifts.allow_early_check_in` column
- Org-wide "today" bucketing (nightly jobs, CSV) → org timezone (`organizations.settings->timezone`)

### Central abstraction
`CheckInService::resolveSchedule($orgId, $userId, $date)` returns a `CheckInSchedule`
value object (`app/Support/CheckInSchedule.php`) with the SAME property names the old
`$policy` had, so ~15 methods that read `$policy->check_in_time` etc. changed only in how
they obtain it. When a user has **no active shift** for the day, it falls back to the exact
old defaults (11:30 / 11:45 / 20:30, org timezone) — so behaviour and most tests are
unchanged. `getPolicy()` / `updatePolicy()` are deleted. `getTodayStatus()` still emits a
`policy` object (now shift-sourced) for FE back-compat, so every tooltip/CheckInCard keeps
working untouched.

### User → shift assignment (prerequisite)
Every user must have a shift for the schedule to resolve. Added:
- Backfill migration `2026_07_23_190906_assign_existing_users_to_morning_shift` — assigns
  each org's active "Morning Shift" to all existing active users (by name, per-org;
  idempotent; skips orgs with none).
- `App\Observers\UserObserver` (`#[ObservedBy]` on User) — assigns the org's Morning Shift
  on user creation, best-effort (never breaks registration).

### Migrations
1. `2026_07_23_200926_add_allow_early_check_in_to_shifts_and_backfill` — adds the column
   and backfills existing shifts' `allow_early_check_in` + (UTC-default) `timezone` from
   the org's policy, preserving behaviour before the drop.
2. `2026_07_24_073017_drop_attendance_policies_table` — drops the table (runs last).

### Removed
- `AttendancePolicyController`, `AttendancePolicyPolicy`, `AttendancePolicy` model +
  factory; routes `GET/PUT /hr/attendance/policy`; web settings page
  (`hr/attendance/settings`), `useAttendancePolicy`/`useUpdateAttendancePolicy` hooks,
  `attendance-policy.ts` schema, and the "Attendance Policy" nav entry.
- The `attendance.manage_policy` permission is now **orphaned** (no route uses it) — left
  in the seeder/role grants intentionally to avoid a permission-parity migration; a future
  cleanup can remove it.

### Web
- Shift form (`ShiftFormSheet`) gains an "Allow early check-in" toggle; `shift.ts` schema +
  `Shift` type gain `allow_early_check_in`; store/update shift requests validate it. New
  shifts default `timezone` to `Asia/Karachi` (PKT deployment).

## Critical correctness note (timezone / grace landmine)
`shifts.timezone` defaulted to **UTC** and `grace_period_minutes` to **0**, whereas the old
policy defaulted to **Asia/Karachi** / **15 min**. The add-column migration backfills
existing shifts' timezone from the policy, the no-shift fallback uses Asia/Karachi, and the
shift form now defaults to Asia/Karachi — so existing orgs keep their window. A shift with a
0 grace legitimately has late-threshold = start_time (the shift is authoritative now).

## Tests
- `resolveSchedule` fallback == old defaults, so most check-in tests are unchanged. Timezone
  tests now assign a shift (`CheckInTest::assignShift`) or set the org timezone
  (`AutoCheckInOnTrackTest`); the removed GET/PUT policy endpoint tests + `manage_policy`
  matrix assertions were deleted.
- Green: CheckIn/AutoCheckIn/ForceCheckOut/MultiSession/Report/RoleMatrix (85), full HR +
  Unit/Services (383), Shift (10). Web: `tsc` clean, shift tests (19). (Pre-existing
  unrelated failures: local `Class "Redis" not found` dashboard test; `CheckInCard.test.tsx`
  missing QueryClientProvider — both fail on `main` too.)

## Key files
- `backend/app/Services/CheckInService.php` (resolveSchedule/orgTimezone/resolveUserShift),
  `backend/app/Support/CheckInSchedule.php`, `backend/app/Services/AttendanceService.php`
  (orgTimezone), `backend/app/Observers/UserObserver.php`, the 3 migrations, shift form
  requests; web `ShiftFormSheet.tsx`, `validations/shift.ts`, `hooks/hr/use-check-in.ts`,
  `config/navigation.ts`.
