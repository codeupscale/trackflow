<?php

namespace App\Services;

use App\Models\AttendancePolicy;
use App\Models\AttendanceRecord;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\LazyCollection;

/**
 * Check-in / checkout self-service attendance.
 *
 * Timezone contract (applied everywhere):
 *   - The org's AttendancePolicy timezone is authoritative.
 *   - now() (UTC) is the authoritative instant — any client-supplied timestamp is ignored.
 *   - The org-local wall clock ($local) is used for window enforcement and the day boundary.
 *   - officialStart / lateAt / offAt are rebuilt per-date via Carbon::parse("$date $time", $tz)
 *     so daylight-saving transitions are handled correctly for each specific day.
 */
class CheckInService
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
    ) {}

    /**
     * How far back to look for an open session when checking out / reporting today.
     * A forgotten checkout after midnight must still link to the open check-in.
     */
    private const OPEN_SESSION_LOOKBACK_HOURS = 36;

    /**
     * Get (or lazily create with defaults) the org's attendance policy.
     */
    public function getPolicy(string $orgId): AttendancePolicy
    {
        return AttendancePolicy::withoutGlobalScopes()->firstOrCreate(
            ['organization_id' => $orgId],
            [
                'check_in_time' => '11:30:00',
                'late_threshold' => '11:45:00',
                'checkout_time' => '20:30:00',
                'timezone' => 'Asia/Karachi',
                'allow_early_check_in' => false,
                'is_active' => true,
            ]
        );
    }

    /**
     * Update the org's attendance policy.
     */
    public function updatePolicy(string $orgId, array $data): AttendancePolicy
    {
        $policy = $this->getPolicy($orgId);
        $policy->update($data);

        return $policy->fresh();
    }

    /**
     * Check the user in for the current org-local day.
     */
    public function checkIn(User $user): AttendanceRecord
    {
        $policy = $this->getPolicy($user->organization_id);
        $tz = $policy->timezone;

        $now = now();                               // UTC, authoritative
        $local = $now->copy()->setTimezone($tz);    // org-local wall clock
        $date = $local->toDateString();             // org-local calendar day

        $officialStart = Carbon::parse("{$date} {$policy->check_in_time}", $tz);
        $lateAt = Carbon::parse("{$date} {$policy->late_threshold}", $tz);

        return DB::transaction(function () use ($user, $policy, $tz, $now, $local, $date, $officialStart, $lateAt) {
            // Lock today's row if it already exists (it may have been pre-created by the
            // nightly attendance job with a null check_in_at, so the unique constraint
            // alone cannot guard the check-in — we need the row lock + null check).
            $existing = AttendanceRecord::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->where('user_id', $user->id)
                ->where('date', $date)
                ->lockForUpdate()
                ->first();

            // Already completed (checked in AND out) for the day — single pair per day (v1).
            if ($existing && $existing->check_out_at !== null) {
                abort(422, 'You have already completed your check-in and checkout for today.');
            }

            // Already checked in (open session) — duplicate.
            if ($existing && $existing->check_in_at !== null) {
                $at = $existing->check_in_at->copy()->setTimezone($tz)->format('g:i A');
                abort(409, "You already checked in at {$at}.");
            }

            // Enforce the check-in window unless early check-in is allowed.
            if (! $policy->allow_early_check_in && $local->lt($officialStart)) {
                $opensAt = $officialStart->format('g:i A');
                abort(422, "Check-in opens at {$opensAt} ({$tz}).");
            }

            // On-time vs late. Boundary (exactly the late threshold) counts as on-time.
            $isLate = $local->gt($lateAt);
            $checkInStatus = $isLate ? 'late' : 'on_time';
            // Late minutes are measured from the OFFICIAL START, not the threshold.
            $lateMinutes = $isLate ? (int) $officialStart->diffInMinutes($local) : 0;

            // Advisory flags (do not block the check-in).
            $flags = [];
            if ($this->attendanceService->isOnApprovedLeave($user, $date)) {
                $flags['on_approved_leave'] = true;
            }
            if ($this->attendanceService->isOffDay($user, $date)) {
                $flags['worked_on_off_day'] = true;
            }

            $status = $this->checkedInStatus($user, $date);

            $record = AttendanceRecord::withoutGlobalScopes()->updateOrCreate(
                [
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'date' => $date,
                ],
                [
                    'check_in_at' => $now,
                    'check_in_status' => $checkInStatus,
                    'check_in_late_minutes' => $lateMinutes,
                    'status' => $status,
                    'check_in_flags' => $flags ?: null,
                ]
            );

            return $record->refresh();
        });
    }

    /**
     * Check the user out, closing their open session.
     */
    public function checkOut(User $user): AttendanceRecord
    {
        $policy = $this->getPolicy($user->organization_id);
        $tz = $policy->timezone;

        $now = now(); // UTC, authoritative

        return DB::transaction(function () use ($user, $policy, $tz, $now) {
            // Find the open session (checked in, not yet out) within the lookback window,
            // so a forgotten checkout that crosses midnight still links to its check-in.
            $record = AttendanceRecord::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->where('user_id', $user->id)
                ->openSessions()
                ->where('check_in_at', '>=', $now->copy()->subHours(self::OPEN_SESSION_LOOKBACK_HOURS))
                ->orderByDesc('check_in_at')
                ->lockForUpdate()
                ->first();

            if (! $record) {
                abort(422, 'No open check-in found. Please check in first.');
            }

            $checkInAt = $record->check_in_at; // Carbon (UTC)

            // Checkout must be strictly after check-in.
            if ($now->lessThanOrEqualTo($checkInAt)) {
                abort(422, 'Checkout time must be after the check-in time.');
            }

            // Absolute instants — spans midnight correctly.
            $workedSeconds = (int) $checkInAt->diffInSeconds($now);

            // Compare against the OFF time of the record's own day (the check-in day).
            $recordDate = $record->date instanceof Carbon
                ? $record->date->toDateString()
                : Carbon::parse((string) $record->date)->toDateString();
            $offAt = Carbon::parse("{$recordDate} {$policy->checkout_time}", $tz);
            $localNow = $now->copy()->setTimezone($tz);

            $isEarly = false;
            $earlyMinutes = 0;
            $overtimeMinutes = 0;

            if ($localNow->lt($offAt)) {
                // Left before the official off time.
                $isEarly = true;
                $earlyMinutes = (int) $localNow->diffInMinutes($offAt);
            } else {
                // At or after the off time — overtime (exactly the off time = 0 OT, normal).
                $overtimeMinutes = (int) $offAt->diffInMinutes($localNow);
            }

            $record->update([
                'check_out_at' => $now,
                'worked_seconds' => $workedSeconds,
                'is_early_checkout' => $isEarly,
                'check_out_early_minutes' => $earlyMinutes,
                'check_out_overtime_minutes' => $overtimeMinutes,
            ]);

            return $record->refresh();
        });
    }

    /**
     * Today's check-in status for the authenticated user (display payload).
     */
    public function getTodayStatus(User $user): array
    {
        $policy = $this->getPolicy($user->organization_id);
        $tz = $policy->timezone;

        $now = now();
        $local = $now->copy()->setTimezone($tz);
        $date = $local->toDateString();

        $record = AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('date', $date)
            ->first();

        // No record for today yet — surface an open session from a prior day (forgotten
        // checkout) so the client can still show the running timer and offer checkout.
        if (! $record) {
            $record = AttendanceRecord::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->where('user_id', $user->id)
                ->openSessions()
                ->where('check_in_at', '>=', $now->copy()->subHours(self::OPEN_SESSION_LOOKBACK_HOURS))
                ->orderByDesc('check_in_at')
                ->first();
        }

        $checkInAt = $record?->check_in_at;
        $checkOutAt = $record?->check_out_at;

        // For an open session, worked_seconds is the live elapsed time.
        $workedSeconds = $record?->worked_seconds;
        if ($checkInAt && ! $checkOutAt) {
            $workedSeconds = (int) $checkInAt->diffInSeconds($now);
        }

        return [
            'checked_in' => $checkInAt !== null,
            'checked_out' => $checkOutAt !== null,
            'check_in_at' => $checkInAt?->toIso8601String(),
            'check_in_at_local' => $checkInAt?->copy()->setTimezone($tz)->toIso8601String(),
            'check_out_at' => $checkOutAt?->toIso8601String(),
            'check_out_at_local' => $checkOutAt?->copy()->setTimezone($tz)->toIso8601String(),
            'check_in_status' => $record?->check_in_status,
            'check_in_late_minutes' => (int) ($record?->check_in_late_minutes ?? 0),
            'is_early_checkout' => (bool) ($record?->is_early_checkout ?? false),
            'check_out_early_minutes' => (int) ($record?->check_out_early_minutes ?? 0),
            'check_out_overtime_minutes' => (int) ($record?->check_out_overtime_minutes ?? 0),
            'missing_checkout' => (bool) ($record?->missing_checkout ?? false),
            'worked_seconds' => $workedSeconds,
            'worked_hhmm' => $this->formatHhmm($workedSeconds),
            'status' => $record?->status,
            'check_in_flags' => $record?->check_in_flags,
            'server_now' => $now->toIso8601String(),
            'policy' => [
                'check_in_time' => $policy->check_in_time,
                'late_threshold' => $policy->late_threshold,
                'checkout_time' => $policy->checkout_time,
                'timezone' => $policy->timezone,
                'allow_early_check_in' => (bool) $policy->allow_early_check_in,
            ],
        ];
    }

    /**
     * Role-scoped list of check-in records.
     * Admins/HR see the whole org; managers see their team; employees see only their own.
     */
    public function listCheckIns(User $user, array $filters): LengthAwarePaginator
    {
        $query = AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->whereNotNull('check_in_at')
            ->with(['user:id,name,email,avatar_url', 'shift:id,name,start_time,end_time']);

        // Role-scoping resolved once, from the attendance.view_all permission (held by
        // admin/owner + hr_manager) down to managed-team members, down to self.
        $scopedUserIds = $this->scopedUserIds($user);
        if ($scopedUserIds !== null) {
            $query->whereIn('user_id', $scopedUserIds);
        }

        // Optional narrowing filter (managers/admins targeting one employee).
        if (! empty($filters['user_id'])) {
            $query->where('user_id', $filters['user_id']);
        }

        if (! empty($filters['start_date'])) {
            $query->where('date', '>=', $filters['start_date']);
        }

        if (! empty($filters['end_date'])) {
            $query->where('date', '<=', $filters['end_date']);
        }

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query->orderByDesc('date')
            ->orderByDesc('check_in_at')
            ->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Backstop: flag open sessions whose org-local day is already in the past as
     * missing_checkout, merging an auto_closed flag. Does NOT fabricate a
     * check_out_at / worked_seconds — the session is left open for regularization.
     *
     * Returns the number of records newly flagged.
     */
    public function autoCloseStaleCheckIns(string $orgId): int
    {
        $policy = $this->getPolicy($orgId);
        $today = now()->setTimezone($policy->timezone)->toDateString();

        $stale = AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->openSessions()
            ->where('missing_checkout', false)
            ->where('date', '<', $today)
            ->get();

        $count = 0;
        foreach ($stale as $record) {
            $flags = $record->check_in_flags ?? [];
            $flags['auto_closed'] = true;

            $record->update([
                'missing_checkout' => true,
                'check_in_flags' => $flags,
            ]);

            $count++;
        }

        return $count;
    }

    /**
     * Per-employee check-in rollup for a period (day or month), role-scoped and
     * paginated. Uses a DB groupBy aggregate — never loads the raw month×employee
     * record set into memory.
     *
     * Each row: user, total_worked_seconds (+ worked_hhmm), days_present, late_count,
     * early_checkout_count, missing_checkout_count.
     */
    public function summarize(User $user, array $filters): LengthAwarePaginator
    {
        $paginator = $this->summaryQuery($user, $filters)
            ->paginate($filters['per_page'] ?? 25);

        $paginator->getCollection()->transform(fn ($row) => $this->mapSummaryRow($row));

        return $paginator;
    }

    /**
     * Lazily stream per-employee rollup rows for a summary CSV export.
     */
    public function summaryRowGenerator(User $user, array $filters): LazyCollection
    {
        return $this->summaryQuery($user, $filters)
            ->cursor()
            ->map(fn ($row) => $this->mapSummaryRow($row));
    }

    /**
     * Lazily stream per-record detail rows for a CSV export. Times are rendered in
     * the org policy timezone. The DB cursor keeps memory bounded for
     * month × all-employees volumes.
     */
    public function detailRowGenerator(User $user, array $filters): LazyCollection
    {
        [$start, $end] = $this->resolvePeriod($filters);
        $scopedUserIds = $this->scopedUserIds($user);
        $tz = $this->getPolicy($user->organization_id)->timezone;

        $query = AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->whereNotNull('check_in_at')
            ->whereBetween('date', [$start, $end])
            ->with('user:id,name,email')
            ->orderBy('date')
            ->orderBy('check_in_at');

        if ($scopedUserIds !== null) {
            $query->whereIn('user_id', $scopedUserIds);
        }

        if (! empty($filters['user_id'])) {
            $query->where('user_id', $filters['user_id']);
        }

        return $query->cursor()->map(function (AttendanceRecord $record) use ($tz) {
            $date = $record->date instanceof Carbon
                ? $record->date->toDateString()
                : Carbon::parse((string) $record->date)->toDateString();

            return [
                'name' => $record->user?->name,
                'email' => $record->user?->email,
                'date' => $date,
                'check_in' => $record->check_in_at?->copy()->setTimezone($tz)->format('Y-m-d H:i:s'),
                'check_out' => $record->check_out_at?->copy()->setTimezone($tz)->format('Y-m-d H:i:s'),
                'worked_hhmm' => $this->formatHhmm($record->worked_seconds),
                'status' => $record->status,
                'late_minutes' => (int) $record->check_in_late_minutes,
                'early_minutes' => (int) $record->check_out_early_minutes,
                'overtime_minutes' => (int) $record->check_out_overtime_minutes,
                'missing_checkout' => (bool) $record->missing_checkout,
            ];
        });
    }

    /**
     * Shared role-scoped, org-scoped groupBy aggregate over check-in records.
     * Returns the query builder so callers can paginate() or cursor().
     */
    private function summaryQuery(User $user, array $filters): \Illuminate\Database\Query\Builder
    {
        [$start, $end] = $this->resolvePeriod($filters);
        $scopedUserIds = $this->scopedUserIds($user);

        $query = DB::table('attendance_records as ar')
            ->join('users as u', 'ar.user_id', '=', 'u.id')
            ->where('ar.organization_id', $user->organization_id)
            ->whereNull('ar.deleted_at')
            ->whereNotNull('ar.check_in_at')
            ->whereBetween('ar.date', [$start, $end]);

        if ($scopedUserIds !== null) {
            $query->whereIn('ar.user_id', $scopedUserIds);
        }

        if (! empty($filters['user_id'])) {
            $query->where('ar.user_id', $filters['user_id']);
        }

        return $query
            ->groupBy('ar.user_id', 'u.name', 'u.email')
            ->select('ar.user_id', 'u.name', 'u.email')
            ->selectRaw('COALESCE(SUM(ar.worked_seconds), 0) as total_worked_seconds')
            ->selectRaw('COUNT(*) as days_present')
            ->selectRaw("SUM(CASE WHEN ar.check_in_status = 'late' THEN 1 ELSE 0 END) as late_count")
            ->selectRaw('SUM(CASE WHEN ar.is_early_checkout THEN 1 ELSE 0 END) as early_checkout_count')
            ->selectRaw('SUM(CASE WHEN ar.missing_checkout THEN 1 ELSE 0 END) as missing_checkout_count')
            ->orderBy('u.name');
    }

    /**
     * Shape a raw aggregate row into the API/export payload.
     */
    private function mapSummaryRow(object $row): array
    {
        $totalWorked = (int) $row->total_worked_seconds;

        return [
            'user' => [
                'id' => $row->user_id,
                'name' => $row->name,
                'email' => $row->email,
            ],
            'total_worked_seconds' => $totalWorked,
            'worked_hhmm' => $this->formatHhmm($totalWorked),
            'days_present' => (int) $row->days_present,
            'late_count' => (int) $row->late_count,
            'early_checkout_count' => (int) $row->early_checkout_count,
            'missing_checkout_count' => (int) $row->missing_checkout_count,
        ];
    }

    /**
     * Resolve the inclusive [startDate, endDate] for a filter set.
     * period=day → single date; period=month → whole calendar month.
     */
    private function resolvePeriod(array $filters): array
    {
        $period = $filters['period'] ?? 'day';

        if ($period === 'month') {
            $month = $filters['month'] ?? now()->format('Y-m');
            $start = Carbon::parse("{$month}-01")->startOfMonth();

            return [$start->toDateString(), $start->copy()->endOfMonth()->toDateString()];
        }

        $date = $filters['date'] ?? now()->toDateString();

        return [$date, $date];
    }

    /**
     * Role → visible user_ids resolution, decided by the attendance.view_all
     * permission (not a hard-coded role string) so team-vs-all stays consistent
     * with the rest of the codebase.
     *
     *   - attendance.view_all (admin/owner + hr_manager) → null (whole org)
     *   - manages one or more teams                      → self + direct reports
     *   - otherwise                                       → self only
     */
    private function scopedUserIds(User $user): ?array
    {
        if (app(\App\Services\PermissionService::class)->hasPermission($user, 'attendance.view_all')) {
            return null; // full org — caller already constrains by organization_id
        }

        $managedTeams = $user->managedTeams()->with('members:id')->get();

        if ($managedTeams->isNotEmpty()) {
            return $managedTeams
                ->flatMap(fn ($team) => $team->members->pluck('id'))
                ->push($user->id)
                ->unique()
                ->values()
                ->all();
        }

        return [$user->id];
    }

    /**
     * Resolve the attendance status for a just-checked-in employee. Reuses the
     * AttendanceService priority (Holiday > On Leave > Weekend); otherwise 'present'.
     */
    private function checkedInStatus(User $user, string $date): string
    {
        if ($this->attendanceService->isHoliday($user->organization_id, $date)) {
            return 'holiday';
        }

        if ($this->attendanceService->isOnApprovedLeave($user, $date)) {
            return 'on_leave';
        }

        $dayOfWeek = strtolower(Carbon::parse($date)->format('l'));
        if (in_array($dayOfWeek, ['saturday', 'sunday'], true)) {
            return 'weekend';
        }

        return 'present';
    }

    /**
     * Format a second count as HH:MM (e.g. 3661 => "01:01"). Null-safe.
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
}
