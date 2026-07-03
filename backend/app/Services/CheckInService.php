<?php

namespace App\Services;

use App\Models\AttendancePolicy;
use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
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
            // 1. Ensure the day row exists. The unique(org,user,date) index serializes the
            //    first-of-day check-in even under concurrency. The row may already exist
            //    (nightly attendance job pre-creates it with a null check_in_at), in which
            //    case its status/columns are left as-is here.
            $record = AttendanceRecord::withoutGlobalScopes()->firstOrCreate(
                [
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'date' => $date,
                ],
                [
                    // Same default status v1 wrote on create; overwritten below for the
                    // first successful check-in and re-derived by the nightly job.
                    'status' => $this->checkedInStatus($user, $date),
                ]
            );

            // 2. Re-select under a row lock — the day-lock anchor for the whole transaction.
            $record = AttendanceRecord::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->whereKey($record->id)
                ->lockForUpdate()
                ->first();

            // 3. Open-session guard: a user may only have one open session at a time.
            $hasOpen = CheckInSession::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->where('attendance_record_id', $record->id)
                ->open()
                ->exists();

            if ($hasOpen) {
                abort(422, 'You already have an open check-in. Please check out first.');
            }

            // 4. Hard pre-window block on EVERY check-in (not only the first). The day row
            //    may already exist from firstOrCreate — we simply do not create a session
            //    and do not mutate any check-in fields.
            if (! $policy->allow_early_check_in && $local->lt($officialStart)) {
                $opensAt = $officialStart->format('g:i A');
                abort(422, "Check-in opens at {$opensAt} ({$tz}).");
            }

            // 5. First-check-in-owned fields (late/status/flags), computed ONCE and never
            //    recomputed on subsequent sessions.
            $isFirst = $record->sessions()->count() === 0;
            if ($isFirst) {
                // On-time vs late. Boundary (exactly the late threshold) counts as on-time.
                $isLate = $local->gt($lateAt);
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

                $record->update([
                    'check_in_status' => $isLate ? 'late' : 'on_time',
                    'check_in_late_minutes' => $lateMinutes,
                    'status' => $this->checkedInStatus($user, $date),
                    'check_in_flags' => $flags ?: null,
                ]);
            }

            // 6-7. Append the new session with the next per-day sequence number.
            $seq = ($record->sessions()->max('seq') ?? 0) + 1;

            CheckInSession::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'attendance_record_id' => $record->id,
                'seq' => $seq,
                'check_in_at' => $now,
                'check_out_at' => null,
            ]);

            // 8. Recompute the day rollup columns from the session set.
            $this->recomputeRecordRollups($record, $policy);

            return $record->refresh();
        });
    }

    /**
     * Check the user out, closing their open session.
     */
    public function checkOut(User $user): AttendanceRecord
    {
        $policy = $this->getPolicy($user->organization_id);

        $now = now(); // UTC, authoritative

        return DB::transaction(function () use ($user, $policy, $now) {
            // 1. Locate the open session (no lock yet — we only need its record id). The
            //    36h lookback lets a forgotten checkout that crosses midnight still close
            //    the prior day's open session.
            $session = CheckInSession::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->where('user_id', $user->id)
                ->open()
                ->where('check_in_at', '>=', $now->copy()->subHours(self::OPEN_SESSION_LOOKBACK_HOURS))
                ->orderByDesc('check_in_at')
                ->first();

            if (! $session) {
                abort(422, 'No open check-in found. Please check in first.');
            }

            // 2. Lock the parent record FIRST (consistent record → session lock order to
            //    avoid deadlock with checkIn, which locks the record then the session).
            $record = AttendanceRecord::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->whereKey($session->attendance_record_id)
                ->lockForUpdate()
                ->first();

            // 3. Re-fetch the session under lock, still open. A concurrent checkout may
            //    have closed it between step 1 and the lock.
            $session = CheckInSession::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->whereKey($session->id)
                ->open()
                ->lockForUpdate()
                ->first();

            if (! $record || ! $session) {
                abort(422, 'No open check-in found. Please check in first.');
            }

            // 4. Checkout must be strictly after this session's check-in.
            if ($now->lessThanOrEqualTo($session->check_in_at)) {
                abort(422, 'Checkout time must be after the check-in time.');
            }

            // 5. Close the session. Early/overtime for the day are derived from the LAST
            //    checkout inside recomputeRecordRollups.
            $session->update(['check_out_at' => $now]);

            // 6. Recompute the day rollup columns from the session set.
            $this->recomputeRecordRollups($record, $policy);

            return $record->refresh();
        });
    }

    /**
     * Recompute a day record's rollup columns from its (non-deleted) session set.
     *
     * Invariants:
     *   - worked_seconds = SUM of CLOSED session durations (open gaps excluded, absolute
     *     instant diff so a session spanning midnight is counted correctly).
     *   - check_in_at    = the FIRST session's check-in (drives "late" — owned by checkIn).
     *   - check_out_at   = the LAST CLOSED session's checkout (drives early/overtime).
     *
     * MUST NOT touch check_in_status / check_in_late_minutes / check_in_flags / status —
     * those are first-check-in-owned and set once in checkIn().
     */
    private function recomputeRecordRollups(AttendanceRecord $record, AttendancePolicy $policy): void
    {
        $tz = $policy->timezone;

        $sessions = $record->sessions()->orderBy('check_in_at')->get();
        $first = $sessions->first();
        $closed = $sessions->whereNotNull('check_out_at');

        // Absolute-instant diff — spans midnight correctly.
        $worked = (int) $closed->sum(
            fn (CheckInSession $s) => $s->check_in_at->diffInSeconds($s->check_out_at)
        );

        /** @var Carbon|null $lastClosedOut */
        $lastClosedOut = $closed->max('check_out_at');

        // Off time of the record's own day (rebuilt per-date so DST is handled).
        $recordDate = $record->date instanceof Carbon
            ? $record->date->toDateString()
            : Carbon::parse((string) $record->date)->toDateString();
        $offAt = Carbon::parse("{$recordDate} {$policy->checkout_time}", $tz);

        $isEarly = false;
        $earlyMinutes = 0;
        $overtimeMinutes = 0;

        if ($lastClosedOut !== null) {
            $localOut = $lastClosedOut->copy()->setTimezone($tz);
            if ($localOut->lt($offAt)) {
                // Left before the official off time.
                $isEarly = true;
                $earlyMinutes = (int) $localOut->diffInMinutes($offAt);
            } else {
                // At or after the off time — overtime (exactly the off time = 0 OT, normal).
                $overtimeMinutes = (int) $offAt->diffInMinutes($localOut);
            }
        }

        $record->update([
            'check_in_at' => $first?->check_in_at,
            'check_out_at' => $lastClosedOut,
            'worked_seconds' => $closed->isEmpty() ? null : $worked,
            'sessions_count' => $sessions->count(),
            'is_early_checkout' => $isEarly,
            'check_out_early_minutes' => $earlyMinutes,
            'check_out_overtime_minutes' => $overtimeMinutes,
        ]);
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
            $openSession = CheckInSession::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->where('user_id', $user->id)
                ->open()
                ->where('check_in_at', '>=', $now->copy()->subHours(self::OPEN_SESSION_LOOKBACK_HOURS))
                ->orderByDesc('check_in_at')
                ->first();

            if ($openSession) {
                $record = AttendanceRecord::withoutGlobalScopes()
                    ->where('organization_id', $user->organization_id)
                    ->whereKey($openSession->attendance_record_id)
                    ->first();
            }
        }

        $sessions = $record
            ? $record->sessions()->orderBy('seq')->get()
            : collect();

        $openSession = $sessions->firstWhere('check_out_at', null);
        $hasOpenSession = $openSession !== null;

        // FE ticker base: sum of already-closed session durations. The client adds the
        // live elapsed time of the open session on top of this.
        $closedWorked = (int) $sessions
            ->whereNotNull('check_out_at')
            ->sum(fn (CheckInSession $s) => $s->check_in_at->diffInSeconds($s->check_out_at));

        $sessionsPayload = $sessions->map(function (CheckInSession $s) use ($tz) {
            $out = $s->check_out_at;
            $worked = $out !== null ? (int) $s->check_in_at->diffInSeconds($out) : null;

            return [
                'seq' => (int) $s->seq,
                'check_in_at' => $s->check_in_at->toIso8601String(),
                'check_in_at_local' => $s->check_in_at->copy()->setTimezone($tz)->toIso8601String(),
                'check_out_at' => $out?->toIso8601String(),
                'check_out_at_local' => $out?->copy()->setTimezone($tz)->toIso8601String(),
                'worked_seconds' => $worked,
                'worked_hhmm' => $this->formatHhmm($worked),
                'is_open' => $out === null,
            ];
        })->values()->all();

        $checkInAt = $record?->check_in_at;   // first session's check-in (rollup)
        $checkOutAt = $record?->check_out_at; // last CLOSED session's checkout (rollup)

        return [
            // Live session-state flags (drive the check-in/checkout button + timer).
            'checked_in' => $hasOpenSession,
            'checked_out' => $sessions->count() > 0 && ! $hasOpenSession,
            'has_open_session' => $hasOpenSession,
            'can_check_in' => ! $hasOpenSession,
            'can_check_out' => $hasOpenSession,
            'sessions_count' => $sessions->count(),
            'closed_worked_seconds' => $closedWorked,
            'open_check_in_at' => $openSession?->check_in_at?->toIso8601String(),
            'sessions' => $sessionsPayload,

            // Day rollup (existing v1 keys preserved).
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
            // Day worked total = closed sum (null until a session closes). FE adds the
            // live open-session elapsed on top for the running display.
            'worked_seconds' => $record?->worked_seconds,
            'worked_hhmm' => $this->formatHhmm($record?->worked_seconds),
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

        // Records from a past org-local day that still carry an OPEN session. The session
        // is deliberately left open (no fabricated check_out_at) for regularization; we
        // only flag the record and recompute its rollup from already-closed sessions.
        $stale = AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('missing_checkout', false)
            ->where('date', '<', $today)
            ->whereHas('sessions', function ($q) use ($orgId) {
                $q->withoutGlobalScopes()
                    ->where('organization_id', $orgId)
                    ->whereNull('check_out_at');
            })
            ->get();

        $count = 0;
        foreach ($stale as $record) {
            $flags = $record->check_in_flags ?? [];
            $flags['auto_closed'] = true;

            $record->update([
                'missing_checkout' => true,
                'check_in_flags' => $flags,
            ]);

            // Rollup reflects the already-closed sessions; the open one stays open.
            $this->recomputeRecordRollups($record, $policy);

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
                'sessions_count' => (int) $record->sessions_count,
                // check_in / check_out are the day rollup: first-in / last-out.
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
