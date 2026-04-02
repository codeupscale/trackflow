<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\AttendanceRegularization;
use App\Models\LeaveRequest;
use App\Models\OvertimeRule;
use App\Models\PublicHoliday;
use App\Models\TimeEntry;
use App\Models\User;
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
                $q->where(function ($sq) use ($carbonDate) {
                    $sq->whereNull('user_shifts.effective_to')
                        ->orWhere('user_shifts.effective_to', '>=', $carbonDate->toDateString());
                })->where(function ($sq) use ($carbonDate) {
                    $sq->whereNull('user_shifts.effective_from')
                        ->orWhere('user_shifts.effective_from', '<=', $carbonDate->toDateString());
                });
            }])
            ->chunk(200, function ($users) use ($orgId, $carbonDate, $date, $dayOfWeek, $isHoliday, &$processedCount) {
        foreach ($users as $user) {
            DB::transaction(function () use ($user, $orgId, $carbonDate, $date, $dayOfWeek, $isHoliday, &$processedCount) {
                // Get the user's active shift for this date
                $shift = $user->shifts->first();

                // Query time entries for this user on this date
                $dayStart = $carbonDate->copy()->startOfDay();
                $dayEnd = $carbonDate->copy()->endOfDay();

                $timeEntries = TimeEntry::withoutGlobalScopes()
                    ->where('organization_id', $orgId)
                    ->where('user_id', $user->id)
                    ->where('started_at', '>=', $dayStart)
                    ->where('started_at', '<=', $dayEnd)
                    ->whereNotNull('ended_at')
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

                // Convert datetime to time strings for the time columns
                $firstSeenTime = $firstSeen ? Carbon::parse($firstSeen)->format('H:i:s') : null;
                $lastSeenTime = $lastSeen ? Carbon::parse($lastSeen)->format('H:i:s') : null;

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
        $onLeave = LeaveRequest::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->where('start_date', '<=', $date->toDateString())
            ->where('end_date', '>=', $date->toDateString())
            ->exists();

        if ($onLeave) {
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
     * Get attendance records for a specific user (paginated, filterable by date range and status).
     */
    public function getAttendance(string $userId, string $orgId, array $filters): LengthAwarePaginator
    {
        $query = AttendanceRecord::where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->with('shift:id,name,start_time,end_time');

        if (!empty($filters['start_date'])) {
            $query->where('date', '>=', $filters['start_date']);
        }

        if (!empty($filters['end_date'])) {
            $query->where('date', '<=', $filters['end_date']);
        }

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query->orderByDesc('date')->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Get team attendance: paginated, filterable by department, user, date range, status.
     * Returns records with user name/email.
     */
    public function getTeamAttendance(string $orgId, array $filters): LengthAwarePaginator
    {
        $query = AttendanceRecord::where('organization_id', $orgId)
            ->with(['user:id,name,email,avatar_url', 'shift:id,name,start_time,end_time']);

        if (!empty($filters['user_id'])) {
            $query->where('user_id', $filters['user_id']);
        }

        if (!empty($filters['department_id'])) {
            $query->whereHas('user.employeeProfile', function ($q) use ($filters) {
                $q->where('department_id', $filters['department_id']);
            });
        }

        if (!empty($filters['start_date'])) {
            $query->where('date', '>=', $filters['start_date']);
        }

        if (!empty($filters['end_date'])) {
            $query->where('date', '<=', $filters['end_date']);
        }

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query->orderByDesc('date')->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Monthly attendance summary for a user.
     */
    public function getAttendanceSummary(string $userId, string $orgId, int $month, int $year): array
    {
        $startOfMonth = Carbon::create($year, $month, 1)->startOfMonth();
        $endOfMonth = $startOfMonth->copy()->endOfMonth();

        $records = AttendanceRecord::where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->whereBetween('date', [$startOfMonth->toDateString(), $endOfMonth->toDateString()])
            ->get();

        $presentDays = $records->where('status', 'present')->count();
        $absentDays = $records->where('status', 'absent')->count();
        $halfDays = $records->where('status', 'half_day')->count();
        $lateDays = $records->where('late_minutes', '>', 0)->count();
        $onLeaveDays = $records->where('status', 'on_leave')->count();
        $overtimeMinutes = $records->sum('overtime_minutes');

        // Total working days = days that aren't weekends or holidays
        $totalWorkingDays = $records->whereNotIn('status', ['weekend', 'holiday'])->count();

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
