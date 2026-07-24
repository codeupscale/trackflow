<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\CheckInSchedule;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\LazyCollection;

/**
 * Check-in / checkout self-service attendance.
 *
 * Schedule contract (applied everywhere):
 *   - Each user's check-in window comes from their assigned SHIFT for the day
 *     (start_time = check-in open, start_time + grace = late threshold, end_time =
 *     checkout time, shift.timezone, shift.allow_early_check_in). Resolved via
 *     resolveSchedule() into a CheckInSchedule value object. When no active shift covers
 *     the day, the org fallback (11:30 / 11:45 / 20:30, org timezone) applies.
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
     * When checkout is requested with no open session, treat a very recent close as
     * success (double-click / stale UI) instead of a confusing 422.
     */
    private const CHECKOUT_IDEMPOTENCY_WINDOW_MINUTES = 5;

    /** Fallback check-in window when a user has no active shift for the day. */
    private const FALLBACK_CHECK_IN_TIME = '11:30:00';

    private const FALLBACK_LATE_THRESHOLD = '11:45:00';

    private const FALLBACK_CHECKOUT_TIME = '20:30:00';

    private const FALLBACK_TIMEZONE = 'Asia/Karachi';

    /**
     * Resolve a user's effective check-in schedule for a day, from their assigned shift
     * (or the org fallback). Returns the same shape the old per-org AttendancePolicy did,
     * so the rest of the service reads $schedule->check_in_time / ->late_threshold /
     * ->checkout_time / ->timezone / ->allow_early_check_in unchanged.
     *
     * $date is the org-local calendar day the schedule applies to; defaults to today in
     * the org timezone.
     */
    public function resolveSchedule(string $orgId, string $userId, ?string $date = null): CheckInSchedule
    {
        $orgTz = $this->orgTimezone($orgId);
        $date ??= now()->setTimezone($orgTz)->toDateString();

        $shift = $this->resolveUserShift($orgId, $userId, $date);

        if ($shift) {
            $start = $this->normalizeTime($shift->start_time);
            $grace = (int) ($shift->grace_period_minutes ?? 0);

            return new CheckInSchedule(
                check_in_time: $start,
                late_threshold: $this->addMinutesToTime($start, $grace),
                checkout_time: $this->normalizeTime($shift->end_time),
                timezone: $shift->timezone ?: $orgTz,
                allow_early_check_in: (bool) $shift->allow_early_check_in,
                shift_id: $shift->id,
            );
        }

        return new CheckInSchedule(
            check_in_time: self::FALLBACK_CHECK_IN_TIME,
            late_threshold: self::FALLBACK_LATE_THRESHOLD,
            checkout_time: self::FALLBACK_CHECKOUT_TIME,
            timezone: $orgTz,
            allow_early_check_in: false,
            shift_id: null,
        );
    }

    /**
     * The org's timezone (org setting, backfilled to Asia/Karachi for this deployment).
     * Used for org-wide "today" bucketing (nightly jobs, CSV) and as the schedule tz
     * fallback. Mirrors the old AttendancePolicy timezone default.
     */
    public function orgTimezone(string $orgId): string
    {
        $org = Organization::withoutGlobalScopes()->find($orgId);

        return $org?->getSetting('timezone') ?: self::FALLBACK_TIMEZONE;
    }

    /**
     * The active shift covering $userId on $date (latest-effective wins on overlap, e.g.
     * a single-day swap override). Inactive / soft-deleted shifts and soft-deleted
     * assignments are excluded. Null when the user has no shift that day.
     */
    private function resolveUserShift(string $orgId, string $userId, string $date): ?Shift
    {
        $shiftId = DB::table('user_shifts')
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->whereNull('deleted_at')
            ->where('effective_from', '<=', $date)
            ->where(function ($q) use ($date) {
                $q->whereNull('effective_to')->orWhere('effective_to', '>=', $date);
            })
            ->orderByDesc('effective_from')
            ->value('shift_id');

        if (! $shiftId) {
            return null;
        }

        return Shift::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->whereKey($shiftId)
            ->first();
    }

    /** Normalize a DB time value ("HH:MM" or "HH:MM:SS") to "HH:MM:SS". */
    private function normalizeTime(string $time): string
    {
        return Carbon::parse($time)->format('H:i:s');
    }

    /** Add whole minutes to an "HH:MM:SS" wall-clock time, returning "HH:MM:SS". */
    private function addMinutesToTime(string $time, int $minutes): string
    {
        return Carbon::createFromFormat('H:i:s', $this->normalizeTime($time))
            ->addMinutes($minutes)
            ->format('H:i:s');
    }

    /**
     * Auto check-in triggered by the desktop starting a timer.
     *
     * Records a check-in AT the moment tracking began ($startedAt), for the
     * org-local day THAT timestamp falls in (not necessarily today — an offline
     * start replays a past instant). It differs from checkIn() in three ways, all
     * deliberate:
     *
     *   1. Timestamp-driven, not now()-driven, so the check-in reflects the true
     *      start of work. (checkIn() ignores client time by contract.)
     *   2. SKIPS the pre-window 422 block — recording an early arrival is the
     *      entire point; rejecting it would defeat the feature.
     *   3. NO-OPS (returns null) instead of aborting when the user already has any
     *      session that day — a manual web check-in, or an earlier auto one, wins.
     *      This is what makes it idempotent under offline replay / start-stop
     *      churn and honors "only if the user has not already checked in".
     *
     * Lateness is still applied honestly: a $startedAt past the late threshold
     * marks the day late. Gated by the org setting `auto_check_in_on_track`.
     *
     * @return AttendanceRecord|null the record when a check-in was created, or null
     *                               when skipped (feature off / already checked in).
     */
    public function autoCheckInFromTracking(User $user, Carbon $startedAt): ?AttendanceRecord
    {
        if (! $user->organization?->getSetting('auto_check_in_on_track', false)) {
            return null;
        }

        $orgTz = $this->orgTimezone($user->organization_id);
        $date = $startedAt->copy()->setTimezone($orgTz)->toDateString(); // the day the start falls in
        $schedule = $this->resolveSchedule($user->organization_id, $user->id, $date);
        $tz = $schedule->timezone;

        $startLocal = $startedAt->copy()->setTimezone($tz); // shift-local wall clock of the real start
        $lateAt = Carbon::parse("{$date} {$schedule->late_threshold}", $tz);

        // Feature A (owner request 2026-07-23): suppress auto check-in for very early
        // starts. A timer started BEFORE `auto_check_in_min_time` (org-local wall clock,
        // default 11:00) does NOT create an attendance check-in — it is a side-effect-free
        // no-op, exactly like the other skip paths. At/after the threshold (boundary
        // inclusive), the original behaviour is unchanged. Resolved per-date in the org tz
        // so DST transitions are handled the same way as the other policy times.
        $minTime = $user->organization?->getSetting('auto_check_in_min_time', '11:00:00') ?: '11:00:00';
        $minAt = Carbon::parse("{$date} {$minTime}", $tz);
        if ($startLocal->lt($minAt)) {
            return null;
        }

        return DB::transaction(function () use ($user, $tz, $startedAt, $startLocal, $date, $lateAt) {
            // 1. Ensure the day row exists (unique(org,user,date) serializes creation).
            $record = AttendanceRecord::withoutGlobalScopes()->firstOrCreate(
                [
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'date' => $date,
                ],
                ['status' => $this->checkedInStatus($user, $date)]
            );

            // 2. Row lock — the transaction's serialization anchor, so a racing
            //    manual web check-in and this path cannot both create a session.
            $record = AttendanceRecord::withoutGlobalScopes()
                ->where('organization_id', $user->organization_id)
                ->whereKey($record->id)
                ->lockForUpdate()
                ->first();

            // 3. Skip if the user already checked in that day — manual web check-in
            //    OR a prior auto one. Guard on ANY session (not just an OPEN one): a
            //    user who already checked in and out earlier must not get a second,
            //    duplicate session from a later timer start.
            $alreadyCheckedIn = $record->check_in_at !== null
                || CheckInSession::withoutGlobalScopes()
                    ->where('organization_id', $user->organization_id)
                    ->where('attendance_record_id', $record->id)
                    ->exists();

            if ($alreadyCheckedIn) {
                return null;
            }

            // 4. First-check-in-owned fields, computed off the REAL start time. No
            //    pre-window block — an early start is exactly what we record.
            $isLate = $startLocal->gt($lateAt);
            $lateMinutes = $isLate ? (int) $lateAt->diffInMinutes($startLocal) : 0;

            $flags = ['auto_check_in' => true]; // marks this as tracker-created, not manual
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
                'check_in_flags' => $flags,
            ]);

            // 5. The session, stamped at the true start. seq is always 1 — the
            //    guard above guarantees no prior session exists.
            CheckInSession::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'attendance_record_id' => $record->id,
                'seq' => 1,
                'check_in_at' => $startedAt,
                'check_out_at' => null,
            ]);

            // 6. Roll up (sets check_in_at = the session's start).
            $this->recomputeRecordRollups($record);

            return $record->refresh();
        });
    }

    /**
     * Check the user in for the current org-local day.
     */
    public function checkIn(User $user): AttendanceRecord
    {
        $schedule = $this->resolveSchedule($user->organization_id, $user->id);
        $tz = $schedule->timezone;

        $now = now();                               // UTC, authoritative
        $local = $now->copy()->setTimezone($tz);    // shift-local wall clock
        $date = $local->toDateString();             // shift-local calendar day

        $officialStart = Carbon::parse("{$date} {$schedule->check_in_time}", $tz);
        $lateAt = Carbon::parse("{$date} {$schedule->late_threshold}", $tz);

        return DB::transaction(function () use ($user, $schedule, $tz, $now, $local, $date, $officialStart, $lateAt) {
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
            if (! $schedule->allow_early_check_in && $local->lt($officialStart)) {
                $opensAt = $officialStart->format('g:i A');
                abort(422, "Check-in opens at {$opensAt} ({$tz}).");
            }

            // 5. First-check-in-owned fields (late/status/flags), computed ONCE and never
            //    recomputed on subsequent sessions.
            $isFirst = $record->sessions()->count() === 0;
            if ($isFirst) {
                // On-time vs late. Boundary (exactly the late threshold) counts as on-time.
                $isLate = $local->gt($lateAt);
                // Late minutes are measured from the LATE THRESHOLD — the grace window
                // up to the threshold is free, so lateness only counts past it.
                $lateMinutes = $isLate ? (int) $lateAt->diffInMinutes($local) : 0;

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
            $this->recomputeRecordRollups($record);

            return $record->refresh();
        });
    }

    /**
     * Check the user out, closing their open session.
     */
    public function checkOut(User $user): AttendanceRecord
    {
        $now = now(); // UTC, authoritative

        return DB::transaction(function () use ($user, $now) {
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
                return $this->checkoutWhenNoOpenSession($user, $now);
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
                return $this->checkoutWhenNoOpenSession($user, $now);
            }

            // 4. Checkout must be strictly after this session's check-in.
            if ($now->lessThanOrEqualTo($session->check_in_at)) {
                abort(422, 'Checkout time must be after the check-in time.');
            }

            // 5. Close the session. Early/overtime for the day are derived from the LAST
            //    checkout inside recomputeRecordRollups.
            $session->update(['check_out_at' => $now]);

            // 6. Recompute the day rollup columns from the session set.
            $this->recomputeRecordRollups($record);

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
    private function recomputeRecordRollups(AttendanceRecord $record): void
    {
        // Off time of the record's own day (rebuilt per-date so DST is handled).
        $recordDate = $record->date instanceof Carbon
            ? $record->date->toDateString()
            : Carbon::parse((string) $record->date)->toDateString();

        // The user's shift schedule for THAT day drives checkout early/overtime + tz.
        $schedule = $this->resolveSchedule($record->organization_id, $record->user_id, $recordDate);
        $tz = $schedule->timezone;

        $sessions = $record->sessions()->orderBy('check_in_at')->get();
        $first = $sessions->first();
        $closed = $sessions->whereNotNull('check_out_at');

        // Absolute-instant diff — spans midnight correctly.
        $worked = (int) $closed->sum(
            fn (CheckInSession $s) => $s->check_in_at->diffInSeconds($s->check_out_at)
        );

        /** @var Carbon|null $lastClosedOut */
        $lastClosedOut = $closed->max('check_out_at');

        $offAt = Carbon::parse("{$recordDate} {$schedule->checkout_time}", $tz);

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

        $payload = [
            'check_in_at' => $first?->check_in_at,
            'check_out_at' => $lastClosedOut,
            'worked_seconds' => $closed->isEmpty() ? null : $worked,
            'sessions_count' => $sessions->count(),
            'is_early_checkout' => $isEarly,
            'check_out_early_minutes' => $earlyMinutes,
            'check_out_overtime_minutes' => $overtimeMinutes,
        ];

        // When every session is closed, the day is complete — clear any stale
        // missing_checkout flag left by the nightly backstop or a prior open session.
        $payload = array_merge($payload, $this->missingCheckoutClearance($record, $sessions));

        $record->update($payload);
    }

    /**
     * Today's check-in status for the authenticated user (display payload).
     */
    public function getTodayStatus(User $user): array
    {
        $schedule = $this->resolveSchedule($user->organization_id, $user->id);
        $tz = $schedule->timezone;

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
            'missing_checkout' => $this->effectiveMissingCheckout($record, $hasOpenSession),
            // Day worked total = closed sum (null until a session closes). FE adds the
            // live open-session elapsed on top for the running display.
            'worked_seconds' => $record?->worked_seconds,
            'worked_hhmm' => $this->formatHhmm($record?->worked_seconds),
            'status' => $record?->status,
            'check_in_flags' => $record?->check_in_flags,
            'server_now' => $now->toIso8601String(),
            // Emitted as `policy` for FE back-compat, but sourced from the user's shift
            // schedule (or the org fallback) rather than the removed attendance policy.
            'policy' => [
                'check_in_time' => $schedule->check_in_time,
                'late_threshold' => $schedule->late_threshold,
                'checkout_time' => $schedule->checkout_time,
                'timezone' => $schedule->timezone,
                'allow_early_check_in' => $schedule->allow_early_check_in,
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
        $today = now()->setTimezone($this->orgTimezone($orgId))->toDateString();

        // Self-heal rows that still carry missing_checkout even though every session
        // closed (e.g. checkout after the backstop ran but before the flag was cleared).
        $this->healStaleMissingCheckoutFlags($orgId);

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
            $this->recomputeRecordRollups($record);

            $count++;
        }

        return $count;
    }

    /**
     * Feature B (owner request 2026-07-23): at the org-local midnight, force a
     * checkout on every OPEN session left over from a day that has already ended.
     *
     * This is DIFFERENT from autoCloseStaleCheckIns(): that backstop only FLAGS the
     * record missing_checkout and deliberately leaves the session open. Here we
     * actually stamp a check_out_at so worked_seconds/overtime are finalised.
     *
     * The stamped checkout is the user's LAST TRACKED ACTIVITY on that session's
     * org-local day (owner decision), falling back to the policy checkout_time when
     * there is no usable activity. The session is always guaranteed to close strictly
     * after its check_in_at.
     *
     * Only records whose org-local `date` is in the PAST (relative to org-local today)
     * are ever touched — a session from the current day is never closed early. Runs
     * inside a per-record transaction with lockForUpdate and re-checks the open state
     * under lock, so a racing manual checkout is never double-closed.
     *
     * @return int number of sessions force-closed.
     */
    public function autoCheckOutOpenSessions(string $orgId): int
    {
        $today = now()->setTimezone($this->orgTimezone($orgId))->toDateString();

        // Records from a PAST org-local day that still carry an OPEN session.
        $stale = AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('date', '<', $today)
            ->whereHas('sessions', function ($q) use ($orgId) {
                $q->withoutGlobalScopes()
                    ->where('organization_id', $orgId)
                    ->whereNull('check_out_at');
            })
            ->get();

        $closed = 0;
        foreach ($stale as $record) {
            $closed += $this->forceCloseRecordOpenSessions($record);
        }

        return $closed;
    }

    /**
     * Force-close a single record's open sessions inside a locked transaction.
     * Returns the number of sessions actually closed (0 when a concurrent checkout
     * already closed them — never double-closes).
     */
    private function forceCloseRecordOpenSessions(AttendanceRecord $record): int
    {
        return DB::transaction(function () use ($record) {
            // 1. Lock the day row first (record → session lock order, same as checkOut()).
            $locked = AttendanceRecord::withoutGlobalScopes()
                ->where('organization_id', $record->organization_id)
                ->whereKey($record->id)
                ->lockForUpdate()
                ->first();

            if (! $locked) {
                return 0;
            }

            // 2. Re-fetch the open sessions UNDER lock. If a manual checkout closed them
            //    between the outer scan and here, there is nothing to do.
            $openSessions = CheckInSession::withoutGlobalScopes()
                ->where('organization_id', $locked->organization_id)
                ->where('attendance_record_id', $locked->id)
                ->open()
                ->lockForUpdate()
                ->orderBy('check_in_at')
                ->get();

            if ($openSessions->isEmpty()) {
                return 0;
            }

            $recordDate = $locked->date instanceof Carbon
                ? $locked->date->toDateString()
                : Carbon::parse((string) $locked->date)->toDateString();

            // The user's shift schedule for that day drives the forced-checkout time.
            $schedule = $this->resolveSchedule($locked->organization_id, $locked->user_id, $recordDate);

            // 3. Resolve the day's last tracked-activity instant once (shared by every
            //    open session on the record — normally just one).
            $lastActivity = $this->lastTrackedActivityInstant(
                $locked->organization_id,
                $locked->user_id,
                $recordDate,
                $schedule->timezone
            );

            $count = 0;
            foreach ($openSessions as $session) {
                $checkoutAt = $this->resolveForcedCheckoutInstant($session, $lastActivity, $recordDate, $schedule);
                $session->update(['check_out_at' => $checkoutAt]);
                $count++;
            }

            // 4. Recompute rollups from the now-closed session set (worked_seconds,
            //    check_out_at, early-checkout/overtime). This also clears missing_checkout
            //    because every session is closed — we re-assert the audit flags below.
            $this->recomputeRecordRollups($locked);

            // 5. Re-assert audit flags AFTER recompute: the checkout was FABRICATED by the
            //    backstop, so the record is flagged missing_checkout + auto_closed
            //    (regularizable). `auto_checked_out` is a durable marker that a checkout was
            //    synthesised — unlike missing_checkout/auto_closed it is never cleared by the
            //    3am close-stale heal, so the fabrication stays auditable.
            $locked->refresh();
            $flags = $locked->check_in_flags ?? [];
            $flags['auto_closed'] = true;
            $flags['auto_checked_out'] = true;
            $locked->update([
                'missing_checkout' => true,
                'check_in_flags' => $flags,
            ]);

            return $count;
        });
    }

    /**
     * The user's last tracked-activity instant on a given org-local day, scoped to org.
     *
     * "Last activity" = the MAX of two signals, whichever is later:
     *   - the last CLOSED tracked time entry's `ended_at` that day (the common case), and
     *   - the last activity-log heartbeat's `logged_at` that day.
     *
     * The heartbeat is the finest-grained record of real work and, crucially, is the ONLY
     * signal available when a tracked entry is still open (null `ended_at`) — so an entry
     * left running gives a truthful last-seen instant instead of nothing. Both are bounded
     * to the org-local day. Returns null when the user had no tracked activity that day.
     */
    private function lastTrackedActivityInstant(string $orgId, string $userId, string $recordDate, string $tz): ?Carbon
    {
        $dayStart = Carbon::parse("{$recordDate} 00:00:00", $tz)->utc();
        $dayEnd = Carbon::parse("{$recordDate} 23:59:59", $tz)->utc();

        $maxEnded = TimeEntry::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->where('type', 'tracked')
            ->whereNotNull('ended_at')
            ->whereBetween('ended_at', [$dayStart, $dayEnd])
            ->max('ended_at');

        $maxHeartbeat = ActivityLog::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->whereBetween('logged_at', [$dayStart, $dayEnd])
            ->max('logged_at');

        $candidates = collect([$maxEnded, $maxHeartbeat])
            ->filter()
            ->map(fn ($v) => $v instanceof Carbon ? $v : Carbon::parse((string) $v, 'UTC'));

        return $candidates->isEmpty() ? null : $candidates->max();
    }

    /**
     * The instant a forced checkout should be stamped for one open session:
     *   1. the day's last tracked activity, when it is strictly after this check-in;
     *   2. else the user's SHIFT checkout_time (end_time) for that day, when after check-in;
     *   3. else check_in_at + 1s — a degenerate guard (e.g. a very late-evening check-in
     *      with no later activity) so the checkout is ALWAYS strictly after the check-in.
     */
    private function resolveForcedCheckoutInstant(CheckInSession $session, ?Carbon $lastActivity, string $recordDate, CheckInSchedule $schedule): Carbon
    {
        $checkInAt = $session->check_in_at;

        if ($lastActivity !== null && $lastActivity->gt($checkInAt)) {
            return $lastActivity->copy();
        }

        $offAt = Carbon::parse("{$recordDate} {$schedule->checkout_time}", $schedule->timezone)->utc();
        if ($offAt->gt($checkInAt)) {
            return $offAt;
        }

        return $checkInAt->copy()->addSecond();
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
        $tz = $this->orgTimezone($user->organization_id);

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
                // Rendered as 12-hour clock times (the row already carries a Date column);
                // matches the 'g:i A' display format used across the attendance API.
                'check_in' => $record->check_in_at?->copy()->setTimezone($tz)->format('g:i A'),
                'check_out' => $record->check_out_at?->copy()->setTimezone($tz)->format('g:i A'),
                'worked_hhmm' => $this->formatHhmm($record->worked_seconds),
                'status' => $record->status,
                'late_minutes' => (int) $record->check_in_late_minutes,
                'early_minutes' => (int) $record->check_out_early_minutes,
                'overtime_minutes' => (int) $record->check_out_overtime_minutes,
                'missing_checkout' => $this->effectiveMissingCheckout(
                    $record,
                    $this->recordHasOpenSession($record)
                ),
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
     * Checkout with no open session: idempotent success for a very recent close, else 422
     * with guidance (desktop timer stop ≠ attendance checkout).
     */
    private function checkoutWhenNoOpenSession(User $user, Carbon $now): AttendanceRecord
    {
        $recent = $this->findRecordFromRecentClosedSession($user, $now);
        if ($recent) {
            return $recent;
        }

        abort(422, $this->checkoutUnavailableMessage($user));
    }

    /**
     * Human-readable 422 when checkout cannot proceed (never checked in, or already
     * checked out earlier without a new check-in after a break).
     */
    private function checkoutUnavailableMessage(User $user): string
    {
        $today = now()->setTimezone($this->orgTimezone($user->organization_id))->toDateString();

        $hasClosedSessionToday = AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('date', $today)
            ->whereHas('sessions', function ($q) use ($user) {
                $q->withoutGlobalScopes()
                    ->where('organization_id', $user->organization_id)
                    ->whereNotNull('check_out_at');
            })
            ->whereDoesntHave('sessions', function ($q) use ($user) {
                $q->withoutGlobalScopes()
                    ->where('organization_id', $user->organization_id)
                    ->open();
            })
            ->exists();

        if ($hasClosedSessionToday) {
            return 'You are already checked out. If you resumed work after a break, tap Check In again when you start — stopping the desktop time tracker does not check you out.';
        }

        return 'No open check-in found. Check in on this page when you start work. Stopping the desktop time tracker does not check you out.';
    }

    /**
     * Idempotent checkout: a session closed within the last few minutes (double-submit
     * or stale UI after a successful checkout).
     */
    private function findRecordFromRecentClosedSession(User $user, Carbon $now): ?AttendanceRecord
    {
        $recentClosed = CheckInSession::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->whereNotNull('check_out_at')
            ->where(
                'check_out_at',
                '>=',
                $now->copy()->subMinutes(self::CHECKOUT_IDEMPOTENCY_WINDOW_MINUTES)
            )
            ->orderByDesc('check_out_at')
            ->first();

        if (! $recentClosed) {
            return null;
        }

        return AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->whereKey($recentClosed->attendance_record_id)
            ->first();
    }

    /**
     * Whether the day record should surface a missing-checkout signal. The DB flag is
     * only meaningful while an open session still exists — once every session is closed
     * (including a late checkout the next morning) the flag is stale.
     */
    private function effectiveMissingCheckout(?AttendanceRecord $record, bool $hasOpenSession): bool
    {
        if ($record === null) {
            return false;
        }

        return (bool) $record->missing_checkout && $hasOpenSession;
    }

    /**
     * Clear missing_checkout / auto_closed when the session set is fully closed.
     *
     * @param  \Illuminate\Support\Collection<int, CheckInSession>  $sessions
     * @return array<string, mixed>
     */
    private function missingCheckoutClearance(AttendanceRecord $record, $sessions): array
    {
        $hasOpen = $sessions->contains(fn (CheckInSession $s) => $s->check_out_at === null);
        if ($hasOpen) {
            return [];
        }

        $flags = $record->check_in_flags ?? [];
        unset($flags['auto_closed']);

        return [
            'missing_checkout' => false,
            'check_in_flags' => $flags === [] ? null : $flags,
        ];
    }

    /**
     * Remove erroneous missing_checkout flags on rows whose sessions are all closed.
     * Runs at the start of the nightly backstop so production data self-heals.
     */
    private function healStaleMissingCheckoutFlags(string $orgId): void
    {
        AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('missing_checkout', true)
            ->chunkById(200, function ($records) {
                foreach ($records as $record) {
                    if ($this->recordHasOpenSession($record)) {
                        continue;
                    }

                    $flags = $record->check_in_flags ?? [];
                    unset($flags['auto_closed']);

                    $record->update([
                        'missing_checkout' => false,
                        'check_in_flags' => $flags === [] ? null : $flags,
                    ]);
                }
            });
    }

    /**
     * Does this record currently have an open check-in session?
     */
    private function recordHasOpenSession(AttendanceRecord $record): bool
    {
        return CheckInSession::withoutGlobalScopes()
            ->where('organization_id', $record->organization_id)
            ->where('attendance_record_id', $record->id)
            ->open()
            ->exists();
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
