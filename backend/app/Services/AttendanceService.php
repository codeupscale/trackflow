<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\AttendanceRegularization;
use App\Models\CheckInSession;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\OvertimeRule;
use App\Models\PublicHoliday;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\TimezoneAwareDateRange;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class AttendanceService
{
    /**
     * Generate daily attendance records for all active users in an organization.
     * Queries time_entries for the given date, computes totals, compares against shifts,
     * and creates/updates attendance_records.
     */
    public function generateDailyAttendance(string $orgId, string $date): int
    {
        $carbonDate = Carbon::parse($date);
        $dayOfWeek = strtolower($carbonDate->format('l')); // monday, tuesday, etc.

        // Check if this date is a public holiday for the org
        $isHoliday = PublicHoliday::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->whereDate('date', $carbonDate)
            ->exists();

        $processedCount = 0;

        // Process users in chunks of 200 to avoid memory pressure on large orgs
        User::where('organization_id', $orgId)
            ->where('is_active', true)
            ->with(['shifts' => function ($q) use ($carbonDate) {
                $date = $carbonDate->toDateString();
                // Use whereRaw to avoid Laravel prefixing pivot column names with "pivot_"
                // which generates non-existent column references like "pivot_effective_to"
                $q->whereRaw('("user_shifts"."effective_to" IS NULL OR "user_shifts"."effective_to" >= ?)', [$date])
                  ->whereRaw('("user_shifts"."effective_from" IS NULL OR "user_shifts"."effective_from" <= ?)', [$date]);
            }])
            ->chunk(200, function ($users) use ($orgId, $carbonDate, $date, $dayOfWeek, $isHoliday, &$processedCount) {
        foreach ($users as $user) {
            DB::transaction(function () use ($user, $orgId, $carbonDate, $date, $dayOfWeek, $isHoliday, &$processedCount) {
                // Get the user's active shift for this date
                $shift = $user->shifts->first();

                // Query time entries for this user on this date.
                // BUG FIX (attendance-present-marked-absent-utc-bucketing): the day
                // boundary must be the user's LOCAL calendar day, converted to UTC bounds,
                // not a raw UTC startOfDay()/endOfDay(). Otherwise early-morning local hours
                // fall into the previous UTC day and a present employee is marked absent.
                // started_at is stored in UTC; the bounds are [start, nextDayStart) — use <.
                $userTz = $user->getTimezoneForDates();
                $dayStart = TimezoneAwareDateRange::startOfDayUtc($date, $userTz);
                $dayEnd = TimezoneAwareDateRange::endOfDayUtc($date, $userTz); // exclusive

                // Exclude `idle` entries from attendance hours and the clock-in/out
                // span. They are audit markers (discarded idle, or a duplicate
                // alongside a reassigned tracked entry); counting them inflates worked
                // hours and can flip the Present/Half-Day/Absent status. `tracked` and
                // `manual` entries are real worked time and count.
                $timeEntries = TimeEntry::withoutGlobalScopes()
                    ->whereNull('time_entries.deleted_at')
                    ->where('organization_id', $orgId)
                    ->where('user_id', $user->id)
                    ->where('started_at', '>=', $dayStart)
                    ->where('started_at', '<', $dayEnd)
                    ->whereNotNull('ended_at')
                    ->where('type', '!=', 'idle')
                    // Only approved worked time counts toward attendance hours.
                    ->where('approval_status', 'approved')
                    ->orderBy('started_at')
                    ->get();

                $totalSeconds = $timeEntries->sum('duration_seconds');
                $totalHours = round($totalSeconds / 3600, 2);

                $firstSeen = $timeEntries->min('started_at');
                $lastSeen = $timeEntries->max('ended_at');

                // Determine status
                $status = $this->determineStatus(
                    $carbonDate,
                    $dayOfWeek,
                    $isHoliday,
                    $shift,
                    $user,
                    $orgId,
                    $totalHours
                );

                // Calculate shift-related metrics
                $lateMinutes = 0;
                $earlyDepartureMinutes = 0;
                $overtimeMinutes = 0;
                $shiftHours = null;

                if ($shift && $firstSeen && $status === 'present') {
                    $shiftStart = $carbonDate->copy()->setTimeFromTimeString($shift->start_time);
                    $shiftEnd = $carbonDate->copy()->setTimeFromTimeString($shift->end_time);

                    // Handle overnight shifts
                    if ($shiftEnd->lte($shiftStart)) {
                        $shiftEnd->addDay();
                    }

                    $shiftHours = ($shiftStart->diffInMinutes($shiftEnd) - ($shift->break_minutes ?? 0)) / 60;

                    // Late arrival
                    $firstSeenCarbon = Carbon::parse($firstSeen);
                    if ($firstSeenCarbon->gt($shiftStart)) {
                        $rawLate = (int) $shiftStart->diffInMinutes($firstSeenCarbon);
                        $lateMinutes = max(0, $rawLate - ($shift->grace_period_minutes ?? 0));
                    }

                    // Early departure
                    $lastSeenCarbon = Carbon::parse($lastSeen);
                    if ($lastSeenCarbon->lt($shiftEnd)) {
                        $earlyDepartureMinutes = (int) $lastSeenCarbon->diffInMinutes($shiftEnd);
                    }

                    // Overtime: hours worked beyond shift hours
                    if ($totalHours > $shiftHours) {
                        $overtimeMinutes = (int) round(($totalHours - $shiftHours) * 60);
                    }
                }

                // Convert datetime to time strings for the time columns.
                // Render in the user's local timezone so a 09:00 local start shows as 09:00:00,
                // not the UTC wall-clock (e.g. 04:00:00 for PKT).
                $firstSeenTime = $firstSeen ? Carbon::parse($firstSeen)->setTimezone($userTz)->format('H:i:s') : null;
                $lastSeenTime = $lastSeen ? Carbon::parse($lastSeen)->setTimezone($userTz)->format('H:i:s') : null;

                // Check-in reconciliation: if the employee physically checked in (via the
                // check-in/checkout feature) but has little/no tracked time, the nightly
                // computation would mark them absent/half_day and hide the fact they were
                // present. Elevate to 'present' so the check-in is honoured. The
                // updateOrCreate payload below deliberately excludes every check-in column,
                // so check_in_at/check_out_at/worked_seconds are never clobbered here.
                $existingRecord = AttendanceRecord::withoutGlobalScopes()
                    ->where('organization_id', $orgId)
                    ->where('user_id', $user->id)
                    ->where('date', $date)
                    ->first();

                if ($existingRecord
                    && $existingRecord->check_in_at !== null
                    && in_array($status, ['absent', 'half_day'], true)) {
                    $status = 'present';
                }

                AttendanceRecord::withoutGlobalScopes()->updateOrCreate(
                    [
                        'organization_id' => $orgId,
                        'user_id' => $user->id,
                        'date' => $date,
                    ],
                    [
                        'status' => $status,
                        'first_seen' => $firstSeenTime,
                        'last_seen' => $lastSeenTime,
                        'total_hours' => $totalHours,
                        'shift_id' => $shift?->id,
                        'expected_start' => $shift?->start_time,
                        'expected_end' => $shift?->end_time,
                        'late_minutes' => $lateMinutes,
                        'early_departure_minutes' => $earlyDepartureMinutes,
                        'overtime_minutes' => $overtimeMinutes,
                    ]
                );

                $processedCount++;
            });
        }
        }); // end chunk

        return $processedCount;
    }

    /**
     * Determine attendance status based on conditions in priority order.
     */
    private function determineStatus(
        Carbon $date,
        string $dayOfWeek,
        bool $isHoliday,
        mixed $shift,
        User $user,
        string $orgId,
        float $totalHours
    ): string {
        // 1. Holiday
        if ($isHoliday) {
            return 'holiday';
        }

        // 2. On approved leave
        if ($this->isOnApprovedLeave($user, $date->toDateString())) {
            return 'on_leave';
        }

        // 3. Weekend (no shift assigned, and day is Sat/Sun)
        $isWeekend = in_array($dayOfWeek, ['saturday', 'sunday']);
        if ($isWeekend && !$shift) {
            return 'weekend';
        }

        // If shift exists, check if this day is in shift's days_of_week
        if ($shift && is_array($shift->days_of_week) && !in_array($dayOfWeek, $shift->days_of_week)) {
            return 'weekend'; // Day off per shift schedule
        }

        // 4. Present / Half-day / Absent based on hours
        if ($totalHours >= 4) {
            return 'present';
        }

        if ($totalHours >= 2) {
            return 'half_day';
        }

        return 'absent';
    }

    /**
     * Whether the given org-local date is a public holiday for the organization.
     * Shared by AttendanceService and CheckInService so the two never diverge.
     */
    public function isHoliday(string $orgId, string $date): bool
    {
        return PublicHoliday::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->whereDate('date', $date)
            ->exists();
    }

    /**
     * Whether the user has an approved leave request covering the given date.
     * Shared by AttendanceService and CheckInService so the two never diverge.
     */
    public function isOnApprovedLeave(User $user, string $date): bool
    {
        return LeaveRequest::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->where('start_date', '<=', $date)
            ->where('end_date', '>=', $date)
            ->exists();
    }

    /**
     * Whether the given date is a non-working day for the user: a public holiday
     * or a weekend (Saturday/Sunday). Used to flag check-ins made on off days.
     */
    public function isOffDay(User $user, string $date): bool
    {
        if ($this->isHoliday($user->organization_id, $date)) {
            return true;
        }

        $dayOfWeek = strtolower(Carbon::parse($date)->format('l'));

        return in_array($dayOfWeek, ['saturday', 'sunday'], true);
    }

    /**
     * Get attendance records for a specific user (paginated, filterable by date range and status).
     */
    /**
     * Self "My Attendance" list — a COMPLETE per-day roster for the user over the range.
     *
     * Where a generated attendance_record exists it is used verbatim (present / half-day /
     * late / overtime stay accurate); where one is missing the day is synthesised with a
     * derived non-worked status (holiday > on_leave > weekend > absent). This mirrors
     * getTeamAttendance() and guarantees every day appears even when GenerateDailyAttendanceJob
     * never ran for the date (the current day, or environments where the scheduler is
     * disabled) — previously the table only showed days the user actually checked in / tracked.
     *
     * Future days are never synthesised (they are not absences yet), so the list reflects
     * the real calendar to-date.
     */
    public function getAttendance(string $userId, string $orgId, array $filters): LengthAwarePaginator
    {
        $perPage = (int) ($filters['per_page'] ?? 25);
        $page = \Illuminate\Pagination\LengthAwarePaginator::resolveCurrentPage();
        $tz = $this->orgTimezone($orgId);

        // Resolve range as org-local DATE STRINGS. Cap the end at today (no future
        // absences); default to month-to-date. Working in strings avoids any tz-instant
        // pitfall between the org-tz "today" and the UTC-parsed filter dates (mixing them
        // made the day-enumeration loop compare instants across timezones).
        $todayStr = Carbon::now($tz)->toDateString();
        $endStr = !empty($filters['end_date'])
            ? Carbon::parse($filters['end_date'])->toDateString()
            : $todayStr;
        if ($endStr > $todayStr) {
            $endStr = $todayStr;
        }
        $startStr = !empty($filters['start_date'])
            ? Carbon::parse($filters['start_date'])->toDateString()
            : Carbon::parse($endStr)->startOfMonth()->toDateString();

        // Empty / inverted range (e.g. a future month) → no rows.
        if ($startStr > $endStr) {
            return new \Illuminate\Pagination\LengthAwarePaginator([], 0, $perPage, $page, [
                'path' => \Illuminate\Pagination\LengthAwarePaginator::resolveCurrentPath(),
            ]);
        }

        // Cap span to avoid runaway synthesis. This path synthesises for ONE user, so a
        // full year is ~366 rows — cheap, and it must cover a year because the period
        // filter offers a "This year" preset. (getTeamAttendance keeps the tighter 92-day
        // cap: it synthesises days × employees.) At 92 days a year selection silently
        // dropped 8 months from the table while the summary cards still counted all 12.
        $maxDays = 366;
        $start = Carbon::parse($startStr);
        $end = Carbon::parse($endStr);
        if ($start->diffInDays($end) > $maxDays) {
            $start = $end->copy()->subDays($maxDays);
            $startStr = $start->toDateString();
        }

        $startDate = $startStr;
        $endDate = $endStr;

        // Existing generated records in range, keyed by date string.
        $existing = AttendanceRecord::where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->whereBetween('date', [$startDate, $endDate])
            ->with('shift:id,name,start_time,end_time,grace_period_minutes')
            ->withCount(['sessions as open_sessions_count' => fn ($q) => $q->whereNull('check_out_at')])
            ->get()
            ->keyBy(fn ($r) => Carbon::parse($r->date)->toDateString());

        // Holidays (date-string set) and this user's approved leaves overlapping the range.
        $holidays = PublicHoliday::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->whereBetween('date', [$startDate, $endDate])
            ->get()
            ->map(fn ($h) => Carbon::parse($h->date)->toDateString())
            ->flip();

        $leaves = LeaveRequest::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->where('start_date', '<=', $endDate)
            ->where('end_date', '>=', $startDate)
            ->get(['user_id', 'start_date', 'end_date'])
            ->groupBy('user_id');

        // Build a complete row per day.
        $rows = [];
        for ($d = Carbon::parse($startStr); $d->lte($end); $d->addDay()) {
            $dateStr = $d->toDateString();
            $record = $existing->get($dateStr);
            if ($record) {
                $rows[] = $this->serializeRecord($record, $tz) + ['is_synthetic' => false];
                continue;
            }

            $rows[] = [
                'id' => "synthetic-{$userId}-{$dateStr}",
                'organization_id' => $orgId,
                'user_id' => $userId,
                'date' => $dateStr,
                'day' => Carbon::parse($dateStr)->format('D'),
                'shift_id' => null,
                'shift_name' => null,
                'expected_start' => null,
                'expected_end' => null,
                'first_seen' => null,
                'last_seen' => null,
                'clock_in' => null,
                'clock_out' => null,
                'total_hours' => 0,
                'status' => $this->deriveAbsentStatus($userId, $dateStr, $holidays, $leaves),
                'late_minutes' => 0,
                'early_departure_minutes' => 0,
                'overtime_minutes' => 0,
                'overtime_hours' => 0,
                'is_regularized' => false,
                // Check-in signal columns — always absent on a synthesised row.
                'check_in_at' => null,
                'check_out_at' => null,
                'worked_seconds' => null,
                'worked_hhmm' => null,
                'check_in_status' => null,
                'check_in_late_minutes' => 0,
                'is_early_checkout' => false,
                'missing_checkout' => false,
                'check_in_flags' => null,
                'is_synthetic' => true,
                'shift' => null,
            ];
        }

        // Optional status filter applied across both real and synthesised rows.
        if (!empty($filters['status'])) {
            $rows = array_values(array_filter($rows, fn ($r) => $r['status'] === $filters['status']));
        }

        // Most recent first (matches the previous orderByDesc('date')).
        usort($rows, fn ($a, $b) => strcmp($b['date'], $a['date']));

        $total = count($rows);
        $items = array_slice($rows, ($page - 1) * $perPage, $perPage);

        return new \Illuminate\Pagination\LengthAwarePaginator($items, $total, $perPage, $page, [
            'path' => \Illuminate\Pagination\LengthAwarePaginator::resolveCurrentPath(),
        ]);
    }

    /**
     * Get team attendance: paginated, filterable by department, user, date range, status.
     *
     * Returns a COMPLETE roster: every active employee gets a row for each day in the
     * range. Where a generated attendance_record exists it is used verbatim (so present /
     * half-day / late / overtime stay accurate); where one is missing the row is
     * synthesised with a derived non-worked status (holiday > on_leave > weekend > absent).
     *
     * This guarantees absent staff always appear, independent of whether the daily
     * GenerateDailyAttendanceJob has run for the date yet (e.g. the current day, or
     * environments where the scheduler is disabled).
     */
    /**
     * @param  array|null  $stats  Out-param: present/absent/late counts over the WHOLE
     *                             filtered set, not just the returned page. The caller
     *                             needs these because the stat strip sits above a
     *                             paginated table — counting the page instead makes
     *                             "Total 200 / Present 0 / Absent 9" impossible to
     *                             reconcile. Free to compute: every row is already
     *                             materialised here before slicing.
     */
    public function getTeamAttendance(string $orgId, array $filters, ?array &$stats = null): LengthAwarePaginator
    {
        $stats = ['total' => 0, 'present' => 0, 'absent' => 0, 'late' => 0];

        $perPage = (int) ($filters['per_page'] ?? 25);
        $page = \Illuminate\Pagination\LengthAwarePaginator::resolveCurrentPage();

        // Resolve range (default to today). Cap span to avoid runaway synthesis.
        $end = !empty($filters['end_date']) ? Carbon::parse($filters['end_date']) : Carbon::now();
        $start = !empty($filters['start_date']) ? Carbon::parse($filters['start_date']) : $end->copy();
        if ($start->gt($end)) {
            $start = $end->copy();
        }
        $maxDays = 92;
        if ($start->diffInDays($end) > $maxDays) {
            $start = $end->copy()->subDays($maxDays);
        }
        $startDate = $start->toDateString();
        $endDate = $end->toDateString();

        // Active employees (filtered by user / department).
        $usersQuery = User::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('is_active', true);

        if (!empty($filters['user_id'])) {
            $usersQuery->where('id', $filters['user_id']);
        }

        if (!empty($filters['department_id'])) {
            $usersQuery->whereHas('employeeProfile', function ($q) use ($filters) {
                $q->where('department_id', $filters['department_id']);
            });
        }

        // Free-text employee search (name / email / employee id). ANDed with the
        // department filter, so it narrows within the selected department rather
        // than widening across the org. LIKE wildcards are escaped so a user typing
        // "%" or "_" gets a literal match instead of a full-table scan.
        if (!empty($filters['search'])) {
            $search = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], trim($filters['search']));
            if ($search !== '') {
                $usersQuery->where(function ($q) use ($search) {
                    $q->where('name', 'ilike', "%{$search}%")
                        ->orWhere('email', 'ilike', "%{$search}%")
                        ->orWhereHas('employeeProfile', function ($p) use ($search) {
                            $p->where('employee_id', 'ilike', "%{$search}%");
                        });
                });
            }
        }

        $users = $usersQuery->orderBy('name')->get(['id', 'name', 'email', 'avatar_url']);
        $userIds = $users->pluck('id');

        if ($userIds->isEmpty()) {
            return new \Illuminate\Pagination\LengthAwarePaginator([], 0, $perPage, $page, [
                'path' => \Illuminate\Pagination\LengthAwarePaginator::resolveCurrentPath(),
            ]);
        }

        // Existing generated records in range, keyed by "user_id|YYYY-MM-DD".
        $existing = AttendanceRecord::where('organization_id', $orgId)
            ->whereIn('user_id', $userIds)
            ->whereBetween('date', [$startDate, $endDate])
            ->with(['user:id,name,email,avatar_url', 'shift:id,name,start_time,end_time,grace_period_minutes'])
            ->withCount(['sessions as open_sessions_count' => fn ($q) => $q->whereNull('check_out_at')])
            ->get()
            ->keyBy(fn ($r) => $r->user_id . '|' . Carbon::parse($r->date)->toDateString());

        // Prefetch holidays (set of date strings) and approved leaves overlapping the range.
        $holidays = PublicHoliday::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->whereBetween('date', [$startDate, $endDate])
            ->get()
            ->map(fn ($h) => Carbon::parse($h->date)->toDateString())
            ->flip();

        $leaves = LeaveRequest::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->whereIn('user_id', $userIds)
            ->where('status', 'approved')
            ->where('start_date', '<=', $endDate)
            ->where('end_date', '>=', $startDate)
            ->get(['user_id', 'start_date', 'end_date'])
            ->groupBy('user_id');

        // Enumerate dates in range.
        $dates = [];
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            $dates[] = $d->toDateString();
        }

        $tz = $this->orgTimezone($orgId);

        $rows = [];
        foreach ($users as $u) {
            foreach ($dates as $dateStr) {
                $record = $existing->get($u->id . '|' . $dateStr);
                if ($record) {
                    $rows[] = $this->serializeRecord($record, $tz) + ['is_synthetic' => false];
                    continue;
                }

                $rows[] = [
                    'id' => "synthetic-{$u->id}-{$dateStr}",
                    'organization_id' => $orgId,
                    'user_id' => $u->id,
                    'date' => $dateStr,
                    'day' => Carbon::parse($dateStr)->format('D'),
                    'shift_id' => null,
                    'shift_name' => null,
                    'expected_start' => null,
                    'expected_end' => null,
                    'first_seen' => null,
                    'last_seen' => null,
                    'clock_in' => null,
                    'clock_out' => null,
                    'total_hours' => 0,
                    'status' => $this->deriveAbsentStatus($u->id, $dateStr, $holidays, $leaves),
                    'late_minutes' => 0,
                    'early_departure_minutes' => 0,
                    'overtime_minutes' => 0,
                    'overtime_hours' => 0,
                    'is_regularized' => false,
                    // Check-in signal columns — always absent on a synthesised row.
                    'check_in_at' => null,
                    'check_out_at' => null,
                    'worked_seconds' => null,
                    'worked_hhmm' => null,
                    'check_in_status' => null,
                    'check_in_late_minutes' => 0,
                    'is_early_checkout' => false,
                    'missing_checkout' => false,
                    'check_in_flags' => null,
                    'is_synthetic' => true,
                    'user' => [
                        'id' => $u->id,
                        'name' => $u->name,
                        'email' => $u->email,
                        'avatar_url' => $u->avatar_url,
                    ],
                    'shift' => null,
                ];
            }
        }

        // Optional status filter applied across both real and synthesised rows.
        if (!empty($filters['status'])) {
            $rows = array_values(array_filter($rows, fn ($r) => $r['status'] === $filters['status']));
        }

        // Sort by date asc (oldest first), then employee name asc.
        usort($rows, function ($a, $b) {
            $cmp = strcmp($a['date'], $b['date']);
            if ($cmp !== 0) {
                return $cmp;
            }
            return strcmp($a['user']['name'] ?? '', $b['user']['name'] ?? '');
        });

        $total = count($rows);

        // Counted over every filtered row, so the stat strip and the paginated
        // table describe the same set.
        $stats = [
            'total' => $total,
            'present' => 0,
            'absent' => 0,
            'late' => 0,
        ];
        foreach ($rows as $r) {
            if ($r['status'] === 'present') {
                $stats['present']++;
            } elseif ($r['status'] === 'absent') {
                $stats['absent']++;
            }
            if (($r['check_in_late_minutes'] ?? 0) > 0) {
                $stats['late']++;
            }
        }

        $items = array_slice($rows, ($page - 1) * $perPage, $perPage);

        return new \Illuminate\Pagination\LengthAwarePaginator($items, $total, $perPage, $page, [
            'path' => \Illuminate\Pagination\LengthAwarePaginator::resolveCurrentPath(),
        ]);
    }

    /**
     * Derive the non-worked status for a day with no attendance record.
     * Synthesised rows have zero worked hours, so they can only be
     * holiday / on_leave / weekend / absent (never present or half-day).
     */
    private function deriveAbsentStatus(string $userId, string $dateStr, $holidays, $leavesByUser): string
    {
        if ($holidays->has($dateStr)) {
            return 'holiday';
        }

        $userLeaves = $leavesByUser->get($userId);
        if ($userLeaves) {
            foreach ($userLeaves as $leave) {
                $from = Carbon::parse($leave->start_date)->toDateString();
                $to = Carbon::parse($leave->end_date)->toDateString();
                if ($dateStr >= $from && $dateStr <= $to) {
                    return 'on_leave';
                }
            }
        }

        $dow = strtolower(Carbon::parse($dateStr)->format('l'));
        if (in_array($dow, ['saturday', 'sunday'])) {
            return 'weekend';
        }

        return 'absent';
    }

    /**
     * Serialize an attendance record into the shape the web dashboard consumes.
     *
     * Reconciles the two attendance signals into single display columns:
     *   - clock_in / clock_out  ← physical check-in/checkout instant (rendered in the
     *     org policy timezone) when present, else the tracker-derived first/last-seen
     *     wall-clock. Only filled from check-in data when it exists, so tracker-only
     *     orgs are unaffected.
     *   - total_hours           ← tracked hours, else the check-in worked_seconds.
     *   - late_minutes          ← check_in_late_minutes when the user checked in,
     *     else the tracker/shift late figure.
     * The raw check-in signal columns are also passed through so the row can render
     * the on-time / late / early-checkout / missing-checkout badge.
     */
    private function serializeRecord(AttendanceRecord $record, string $tz): array
    {
        $date = $record->date instanceof Carbon
            ? $record->date->toDateString()
            : Carbon::parse((string) $record->date)->toDateString();

        $checkInAt = $record->check_in_at;   // Carbon|null (UTC) — first session's check-in
        $checkOutAt = $record->check_out_at; // Carbon|null (UTC) — LAST CLOSED session's checkout

        // Post multi-session redesign, check_out_at is the last CLOSED session's checkout,
        // so "check_out_at IS NULL" no longer means "still working" — a record can hold a
        // closed checkout AND a later open session. Derive the live state from an actual
        // open-session existence check so we never render a stale checkout while a later
        // session is running.
        $hasOpenSession = $this->recordHasOpenSession($record);

        $clockIn = $checkInAt
            ? $checkInAt->copy()->setTimezone($tz)->format('g:i A')
            : $this->trimTime($record->first_seen);

        if ($hasOpenSession) {
            // Still checked in — no checkout to display yet.
            $clockOut = null;
            $checkOutAt = null;
        } else {
            $clockOut = $checkOutAt
                ? $checkOutAt->copy()->setTimezone($tz)->format('g:i A')
                : $this->trimTime($record->last_seen);
        }

        // Hours: tracked time wins; otherwise the check-in session length (set on checkout).
        $totalHours = (float) $record->total_hours;
        if ($totalHours <= 0 && $record->worked_seconds !== null) {
            $totalHours = round($record->worked_seconds / 3600, 2);
        }

        // Late: the physical check-in figure wins whenever the employee checked in.
        $lateMinutes = $checkInAt !== null
            ? (int) ($record->check_in_late_minutes ?? 0)
            : (int) $record->late_minutes;

        // Overtime: tracker OT, else the checkout overtime.
        $overtimeMinutes = (int) $record->overtime_minutes;
        if ($overtimeMinutes <= 0) {
            $overtimeMinutes = (int) ($record->check_out_overtime_minutes ?? 0);
        }

        $data = [
            'id' => $record->id,
            'organization_id' => $record->organization_id,
            'user_id' => $record->user_id,
            'date' => $date,
            'day' => Carbon::parse($date)->format('D'),
            'status' => $record->status,
            'shift_id' => $record->shift_id,
            'shift_name' => $record->shift?->name,
            'expected_start' => $record->expected_start,
            'expected_end' => $record->expected_end,
            'first_seen' => $record->first_seen,
            'last_seen' => $record->last_seen,
            'clock_in' => $clockIn,
            'clock_out' => $clockOut,
            'total_hours' => $totalHours,
            'late_minutes' => $lateMinutes,
            'early_departure_minutes' => (int) $record->early_departure_minutes,
            'overtime_minutes' => $overtimeMinutes,
            'overtime_hours' => round($overtimeMinutes / 60, 2),
            'is_regularized' => (bool) $record->is_regularized,
            // Check-in / checkout signal columns (drive the row badge + clock display).
            'check_in_at' => $checkInAt?->toIso8601String(),
            'check_out_at' => $checkOutAt?->toIso8601String(),
            'worked_seconds' => $record->worked_seconds,
            'worked_hhmm' => $this->formatHhmm($record->worked_seconds),
            'check_in_status' => $record->check_in_status,
            'check_in_late_minutes' => (int) ($record->check_in_late_minutes ?? 0),
            'is_early_checkout' => (bool) $record->is_early_checkout,
            // Day-completion snapshot — the authoritative short-day signal, taken
            // against the rule in force on that day.
            'required_day_seconds' => $record->required_day_seconds,
            'met_required_hours' => $record->met_required_hours,
            'missing_checkout' => (bool) $record->missing_checkout && $hasOpenSession,
            'check_in_flags' => $record->check_in_flags,
            'shift' => $record->shift ? [
                'id' => $record->shift->id,
                'name' => $record->shift->name,
                'start_time' => $record->shift->start_time,
                'end_time' => $record->shift->end_time,
                // Needed client-side: the short-day badge must tolerate a
                // check-in inside the grace window, otherwise arriving at
                // 11:45 on an 11:30 shift and leaving on time reads as short.
                'grace_period_minutes' => (int) ($record->shift->grace_period_minutes ?? 0),
            ] : null,
        ];

        if ($record->relationLoaded('user') && $record->user) {
            $data['user'] = [
                'id' => $record->user->id,
                'name' => $record->user->name,
                'email' => $record->user->email,
                'avatar_url' => $record->user->avatar_url,
            ];
        }

        return $data;
    }

    /**
     * Does this record currently have an open check-in session (checked in, not yet
     * out)? Prefers the eager-loaded `open_sessions_count` (set via withCount at the
     * query sites) to avoid an N+1; falls back to a single org-scoped existence query.
     */
    private function recordHasOpenSession(AttendanceRecord $record): bool
    {
        if (array_key_exists('open_sessions_count', $record->getAttributes())) {
            return (int) $record->open_sessions_count > 0;
        }

        return CheckInSession::withoutGlobalScopes()
            ->where('organization_id', $record->organization_id)
            ->where('attendance_record_id', $record->id)
            ->open()
            ->exists();
    }

    /**
     * The org timezone, used to render check-in instants / attendance rows as org-local
     * wall-clock. Sourced from the org setting (backfilled to Asia/Karachi for this
     * deployment); falls back to the app timezone.
     */
    private function orgTimezone(string $orgId): string
    {
        $org = Organization::withoutGlobalScopes()->find($orgId);

        return $org?->getSetting('timezone') ?: (string) config('app.timezone', 'UTC');
    }

    /**
     * Render a stored H:i:s wall-clock string as a 12-hour display time
     * (e.g. "09:00:00" → "9:00 AM"). Kept consistent with the check_in_at /
     * check_out_at 'g:i A' formatting so both the physical check-in and the
     * tracker-derived fallback render the same way. Null-safe.
     */
    private function trimTime(?string $time): ?string
    {
        if ($time === null || $time === '') {
            return null;
        }

        return Carbon::createFromFormat('H:i:s', substr($time, 0, 8))->format('g:i A');
    }

    /**
     * Format a second count as HH:MM (mirrors CheckInService::formatHhmm). Null-safe.
     */
    private function formatHhmm(?int $seconds): ?string
    {
        if ($seconds === null) {
            return null;
        }

        $hours = intdiv($seconds, 3600);
        $minutes = intdiv($seconds % 3600, 60);

        return sprintf('%02d:%02d', $hours, $minutes);
    }

    /**
     * Monthly attendance summary for a user.
     */
    /**
     * Attendance summary for a period.
     *
     * $month/$year select a single month (the original contract). Passing
     * $startDate/$endDate overrides them with an arbitrary range, so the stat
     * cards can follow a quarter/year period filter instead of being pinned to
     * one month — otherwise a "this quarter" listing would sit above a single
     * month's totals.
     */
    public function getAttendanceSummary(
        string $userId,
        string $orgId,
        int $month,
        int $year,
        ?string $startDate = null,
        ?string $endDate = null,
    ): array {
        if ($startDate !== null && $endDate !== null) {
            $startOfMonth = Carbon::parse($startDate)->startOfDay();
            $endOfMonth = Carbon::parse($endDate)->endOfDay();
        } else {
            $startOfMonth = Carbon::create($year, $month, 1)->startOfMonth();
            $endOfMonth = $startOfMonth->copy()->endOfMonth();
        }

        $tz = $this->orgTimezone($orgId);

        $records = AttendanceRecord::where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->whereBetween('date', [$startOfMonth->toDateString(), $endOfMonth->toDateString()])
            ->get()
            ->keyBy(fn ($r) => Carbon::parse($r->date)->toDateString());

        // Absent/weekend/holiday/on-leave days rarely have a persisted record on dev
        // (GenerateDailyAttendanceJob only runs in prod), so counting existing rows
        // undercounts absences and working days. Walk the real calendar (month-to-date)
        // instead — using the record where it exists and a derived status where it
        // doesn't (mirrors getAttendance()).
        $holidays = PublicHoliday::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->whereBetween('date', [$startOfMonth->toDateString(), $endOfMonth->toDateString()])
            ->get()
            ->map(fn ($h) => Carbon::parse($h->date)->toDateString())
            ->flip();

        $leaves = LeaveRequest::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->where('start_date', '<=', $endOfMonth->toDateString())
            ->where('end_date', '>=', $startOfMonth->toDateString())
            ->get(['user_id', 'start_date', 'end_date'])
            ->groupBy('user_id');

        // Only summarise up to today — future days aren't absences yet. Use org-local
        // date strings so the org-tz "today" and the month bounds compare tz-safely.
        $todayStr = Carbon::now($tz)->toDateString();
        $rangeStartStr = $startOfMonth->toDateString();
        $rangeEndStr = $endOfMonth->toDateString();
        if ($rangeEndStr > $todayStr) {
            $rangeEndStr = $todayStr;
        }

        $presentDays = $absentDays = $halfDays = $lateDays = $onLeaveDays = 0;
        $totalWorkingDays = 0;
        $overtimeMinutes = 0;

        $rangeEnd = Carbon::parse($rangeEndStr);
        for ($d = Carbon::parse($rangeStartStr); $rangeStartStr <= $rangeEndStr && $d->lte($rangeEnd); $d->addDay()) {
            $dateStr = $d->toDateString();
            $record = $records->get($dateStr);
            $status = $record ? $record->status : $this->deriveAbsentStatus($userId, $dateStr, $holidays, $leaves);

            match ($status) {
                'present' => $presentDays++,
                'absent' => $absentDays++,
                'half_day' => $halfDays++,
                'on_leave' => $onLeaveDays++,
                default => null,
            };

            // Total working days = days that aren't weekends or holidays.
            if (!in_array($status, ['weekend', 'holiday'], true)) {
                $totalWorkingDays++;
            }

            if ($record) {
                // Lateness has two independent sources that must both count: the legacy
                // tracker-era `late_minutes` column and the manual check-in
                // `check_in_late_minutes` (marked `check_in_status = late`).
                if ((int) $record->late_minutes > 0
                    || (int) ($record->check_in_late_minutes ?? 0) > 0
                    || $record->check_in_status === 'late') {
                    $lateDays++;
                }
                // Overtime: tracker `overtime_minutes`, falling back to the manual
                // checkout `check_out_overtime_minutes` when the tracker recorded none.
                $tracker = (int) $record->overtime_minutes;
                $overtimeMinutes += $tracker > 0 ? $tracker : (int) ($record->check_out_overtime_minutes ?? 0);
            }
        }

        return [
            'month' => $month,
            'year' => $year,
            'present_days' => $presentDays,
            'absent_days' => $absentDays,
            'half_days' => $halfDays,
            'late_days' => $lateDays,
            'on_leave_days' => $onLeaveDays,
            'overtime_hours' => round($overtimeMinutes / 60, 2),
            'total_working_days' => $totalWorkingDays,
        ];
    }

    /**
     * Request regularization for an attendance record.
     * Validates: record belongs to user's org, only one pending regularization per record.
     */
    public function requestRegularization(User $user, string $recordId, array $data): AttendanceRegularization
    {
        $record = AttendanceRecord::where('organization_id', $user->organization_id)
            ->findOrFail($recordId);

        // Ensure the record belongs to the requesting user
        if ($record->user_id !== $user->id) {
            abort(403, 'You can only regularize your own attendance records.');
        }

        // Cannot regularize holidays or leave days
        if (in_array($record->status, ['on_leave', 'holiday'])) {
            abort(422, 'Cannot regularize attendance for leave or holiday days.');
        }

        // Only one pending regularization per record
        $existingPending = AttendanceRegularization::where('attendance_record_id', $record->id)
            ->where('status', 'pending')
            ->exists();

        if ($existingPending) {
            abort(422, 'A pending regularization already exists for this record.');
        }

        return AttendanceRegularization::create([
            'organization_id' => $user->organization_id,
            'attendance_record_id' => $record->id,
            'user_id' => $user->id,
            'requested_status' => $data['requested_status'],
            'reason' => $data['reason'],
            'status' => 'pending',
        ]);
    }

    /**
     * Approve a regularization request. Updates the attendance record.
     */
    public function approveRegularization(AttendanceRegularization $reg, User $approver): AttendanceRegularization
    {
        return DB::transaction(function () use ($reg, $approver) {
            // Update the attendance record (scoped by org for defense-in-depth)
            $record = AttendanceRecord::where('organization_id', $reg->organization_id)
                ->findOrFail($reg->attendance_record_id);
            $record->update([
                'status' => $reg->requested_status,
                'is_regularized' => true,
            ]);

            // Update the regularization
            $reg->update([
                'status' => 'approved',
                'reviewed_by' => $approver->id,
                'reviewed_at' => now(),
            ]);

            return $reg->fresh()->load(['attendanceRecord', 'user:id,name,email', 'reviewedBy:id,name,email']);
        });
    }

    /**
     * Reject a regularization request.
     */
    public function rejectRegularization(AttendanceRegularization $reg, User $approver, string $note): AttendanceRegularization
    {
        $reg->update([
            'status' => 'rejected',
            'reviewed_by' => $approver->id,
            'reviewed_at' => now(),
            'review_note' => $note,
        ]);

        return $reg->fresh()->load(['attendanceRecord', 'user:id,name,email', 'reviewedBy:id,name,email']);
    }

    /**
     * Get or create default overtime rule for an organization.
     */
    public function getOvertimeRule(string $orgId): OvertimeRule
    {
        return OvertimeRule::withoutGlobalScopes()
            ->firstOrCreate(
                ['organization_id' => $orgId],
                [
                    'daily_threshold_hours' => 8,
                    'weekly_threshold_hours' => 40,
                    'overtime_multiplier' => 1.5,
                    'weekend_multiplier' => 2.0,
                ]
            );
    }

    /**
     * Update overtime rule for an organization.
     */
    public function updateOvertimeRule(string $orgId, array $data): OvertimeRule
    {
        $rule = $this->getOvertimeRule($orgId);
        $rule->update($data);

        return $rule->fresh();
    }
}
