# Attendance — Present devs marked "Absent" (UTC day-bucketing + tracked-time-only inference)

**Status:** 🟡 PRIMARY CAUSE FIXED 2026-06-17 (branch `chore/desktop-electron-42-upgrade`, uncommitted at time of writing)

## Resolution summary (2026-06-17)
- **Cause A (timezone bucketing — the reported symptom):** `generateDailyAttendance()` now builds the
  day window in the **employee's timezone** and converts to UTC bounds, instead of a raw UTC
  `startOfDay()`/`endOfDay()`:
  `TimezoneAwareDateRange::startOfDayUtc($date, $user->getTimezoneForDates())` … `endOfDayUtc(...)`,
  queried as `started_at >= $dayStart AND started_at < $dayEnd` (exclusive upper bound).
  Early-morning local hours now count toward the correct local day, so present employees are no
  longer marked absent (`app/Services/AttendanceService.php`).
- **Cosmetic knock-on:** `first_seen` / `last_seen` are now formatted in the user's timezone, so a
  09:00 local start shows as `09:00:00` rather than the UTC wall-clock.

_Verified:_ `AttendanceServiceTest` + `Hr/AttendanceTest` pass (one unrelated pre-existing failure in
`test_team_attendance_filters_by_department_id` — an `APP_KEY`/encryption env issue in the
`EmployeeProfile` factory, fails identically without these changes).

_Remaining follow-ups (tracked, NOT yet done):_
- **Cause B** — entries are still bucketed by `started_at`; overlap-based attribution / boundary
  splitting is not implemented.
- **Cause C** — still-open (un-ended) entries are still excluded at job time.
- **Cause D** — presence is still inferred from tracked hours with hardcoded 2h/4h thresholds (no
  heartbeat signal, not org-configurable).
- **Scheduler** — still a single 00:30 UTC run. Safe for PKT (= 05:30 local, after local midnight),
  but per-timezone scheduling is the robust long-term fix.

---

**Status (original):** 🔴 OPEN — not yet fixed
**Reported:** 2026-06-17 (multiple devs)
**Investigated:** 2026-06-17 (read-only, on branch `chore/desktop-electron-42-upgrade`)
**Scope:** Backend HR — `AttendanceService::generateDailyAttendance()` + the daily scheduler
**Severity:** P1 — payroll/attendance shows employees as absent on days they actually worked.
Directly damages trust and can affect pay/leave deductions.

## How "Absent" is identified (there is no "absent" event — it's inferred)

Attendance is **derived from tracked time**, never observed directly:

1. A scheduler runs **daily at 00:30 UTC** and processes "yesterday" computed in UTC:
   `routes/console.php:76-86` — `$yesterday = now()->subDay()->toDateString()` → dispatches
   `GenerateDailyAttendanceJob` per org. The job also defaults to `now()->subDay()` in UTC
   (`app/Jobs/GenerateDailyAttendanceJob.php:30`).
2. `AttendanceService::generateDailyAttendance($orgId, $date)` builds a day window and sums hours:
   - `app/Services/AttendanceService.php:54-55` — `$dayStart = Carbon::parse($date)->startOfDay()`,
     `$dayEnd = …->endOfDay()`. `Carbon::parse()` uses the **app default timezone = UTC**
     (`config/app.php:68`). So the window is the **UTC** calendar day.
   - `app/Services/AttendanceService.php:57-67` — sums `duration_seconds` of time entries where
     `started_at` ∈ [dayStart, dayEnd] **and `whereNotNull('ended_at')`** (completed entries only).
3. `determineStatus()` then maps hours → status (`app/Services/AttendanceService.php:163-201`),
   in priority order: Holiday → On-leave → Weekend/day-off → then **by hours**:
   - `totalHours >= 4` → `present`
   - `totalHours >= 2` → `half_day`
   - else → **`absent`**

So "absent" simply means *"< 2 hours of completed, timer-tracked entries whose `started_at` fell in
the UTC calendar day."* If that window or that sum is wrong, a present employee is labelled absent.

## Why present devs get marked Absent

### Cause A (primary) — the day window is **UTC**, not the employee's timezone
Time entries are stored in UTC, but an employee's real workday is in their **local** timezone. The
window is built in UTC with no per-user/org timezone applied, so the buckets are offset by the
user's UTC offset. This is the **attendance-layer manifestation of the timezone defect already
filed** in [timezone-midnight-rolls-to-previous-day.md](timezone-midnight-rolls-to-previous-day.md).

Worked example — Pakistan dev (PKT = UTC+5), works **01:00–06:00 PKT on 2026-06-17** (5h):
| | Local (PKT) | Stored (UTC) |
|---|---|---|
| Work interval | 2026-06-17 01:00 → 06:00 | 2026-06-16 20:00 → 2026-06-17 01:00 |

The job's window for **2026-06-17** is `00:00–23:59 UTC`. Of the 5 hours, only **01:00 UTC**
(= 1 hour) falls inside it; the other **4 hours** are bucketed to **2026-06-16**.
→ The 2026-06-17 record shows `total_hours = 1` → **Absent**, despite a full 5-hour day.

Any employee whose local hours straddle UTC midnight (for PKT, anything before ~05:00 local) gets
their day split across two attendance records, and each piece can fall under the 2h / 4h thresholds.
A standard 09:00–17:00 PKT (= 04:00–12:00 UTC) shift sits inside the UTC day and is unaffected — which
is why it hits *some* devs and not others.

### Cause B — bucketed by `started_at` only (overnight / boundary entries mis-split)
`app/Services/AttendanceService.php:60-61` filters on `started_at` only. An entry that **started**
before `$dayStart` but ran into the day is excluded entirely; an overnight session is attributed
100% to its start day. A single long session crossing UTC midnight lands wholly in one bucket.

### Cause C — only **completed** entries count
`whereNotNull('ended_at')` (`app/Services/AttendanceService.php:62`) excludes any entry still open
(or never properly stopped) when the job runs. Time tracked but not cleanly closed → not counted.

### Cause D — inference is **tracked-time only**, thresholds are strict
A present employee whose tracked time is low for legitimate reasons (in meetings, forgot to start
the timer, did non-tracked work) is marked **absent** at `< 2h` and only **half_day** below 4h —
even though they were present. There is no "was the desktop agent online / heartbeating today"
signal feeding the status; presence is equated with *timer* hours.

## Cosmetic knock-on
`first_seen` / `last_seen` are formatted from UTC timestamps with `->format('H:i:s')`
(`app/Services/AttendanceService.php:120-121`), so a 09:00 PKT start is stored/shown as `04:00:00`.
Confusing on the attendance UI even when the status happens to be right.

## Reproduction
1. As a PKT (or any non-UTC) user, track ~5h entirely between 00:00 and 05:00 local time.
2. Let the daily attendance job run (00:30 UTC) for that date, or call
   `POST /hr/attendance/generate` for it.
3. The attendance record for that local date shows a fraction of the hours → **Absent / Half Day**,
   while the previous date carries phantom hours.

## Recommended fix
**Cause A (primary — shared with the timezone bug):**
- Compute the day window in the **employee's (or org's) timezone**, then convert to UTC bounds for
  the query — reuse `App\Support\TimezoneAwareDateRange::startOfDayUtc()` / `endOfDayUtc($date, $tz)`
  with `User::getTimezoneForDates()` instead of `Carbon::parse($date)->startOfDay()`/`endOfDay()`.
- The scheduler/job's notion of "yesterday" must also be per-timezone (a single 00:30 UTC run can't
  represent "yesterday" for every zone) — consider running per-org at the org's local 00:30, or
  generating for the date that just ended in the org's timezone.

**Cause B:** attribute hours by **overlap with the window**, not by `started_at`, or split entries at
the day boundary (consistent with how the rest of the app should bucket once timezone-aware).

**Cause C:** decide policy for still-open entries at job time (clamp to window end, or run after a
guaranteed close) so active trackers aren't undercounted.

**Cause D:** reconsider equating presence with tracked hours. If the product intends "absent = no
work signal," factor in agent heartbeats / first-seen activity, and make the 2h/4h thresholds
configurable per org (an `overtime_rules`-style setting) rather than hardcoded
(`app/Services/AttendanceService.php:193,197`).

**Verify after fixing:** a PKT user tracking 00:00–05:00 local must produce a `present` record on the
**local** date with the correct `total_hours`, and no phantom record on the adjacent date.

## Notes
- Shares its root cause with [timezone-midnight-rolls-to-previous-day.md](timezone-midnight-rolls-to-previous-day.md);
  fixing the timezone-aware bucketing there should be coordinated with this so both use one helper.
- All `file:line` references were accurate on 2026-06-17 on branch
  `chore/desktop-electron-42-upgrade`; re-verify before fixing.
