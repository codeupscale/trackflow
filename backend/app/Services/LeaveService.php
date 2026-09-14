<?php

namespace App\Services;

use App\Exceptions\InsufficientLeaveBalanceException;
use App\Exceptions\LeaveOverlapException;
use App\Models\LeaveBalance;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\PublicHoliday;
use App\Models\User;
use App\Notifications\LeaveResolved;
use App\Notifications\OrgActivity;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class LeaveService
{
    use \App\Support\AnnouncesOrgActivity;

    public function __construct(private readonly PermissionService $permissionService) {}

    /**
     * Apply for leave. Validates balance, checks overlaps, deducts pending days.
     *
     * @throws InsufficientLeaveBalanceException
     * @throws LeaveOverlapException
     */
    public function applyLeave(User $user, array $data): LeaveRequest
    {
        $orgId = $user->organization_id;
        $startDate = Carbon::parse($data['start_date']);
        $endDate = Carbon::parse($data['end_date']);
        $halfDay = (bool) ($data['half_day'] ?? false);

        // Check for overlapping leave requests (pending or approved)
        $overlap = LeaveRequest::where('user_id', $user->id)
            ->whereIn('status', ['pending', 'approved'])
            ->where('start_date', '<=', $endDate)
            ->where('end_date', '>=', $startDate)
            ->exists();

        if ($overlap) {
            throw new LeaveOverlapException();
        }

        $workingDays = $this->calculateWorkingDays($startDate, $endDate, $orgId, $halfDay);

        $created = DB::transaction(function () use ($user, $data, $orgId, $startDate, $endDate, $workingDays, $halfDay) {
            $year = $startDate->year;

            // Get or initialize balance
            $balance = LeaveBalance::where('user_id', $user->id)
                ->where('leave_type_id', $data['leave_type_id'])
                ->where('year', $year)
                ->lockForUpdate()
                ->first();

            if (! $balance) {
                // Auto-initialize balances for this year if missing
                $this->initializeBalances($user, $orgId, $year);

                $balance = LeaveBalance::where('user_id', $user->id)
                    ->where('leave_type_id', $data['leave_type_id'])
                    ->where('year', $year)
                    ->lockForUpdate()
                    ->first();
            }

            if (! $balance) {
                throw new InsufficientLeaveBalanceException('No leave balance found for this leave type.');
            }

            $available = $balance->total_days + $balance->carried_over_days - $balance->used_days - $balance->pending_days;

            if ($available < $workingDays) {
                throw new InsufficientLeaveBalanceException(
                    "Insufficient leave balance. Available: {$available} days, Requested: {$workingDays} days."
                );
            }

            // Deduct pending days
            $balance->increment('pending_days', $workingDays);

            // Create leave request
            $leaveRequest = LeaveRequest::create([
                'organization_id' => $orgId,
                'user_id' => $user->id,
                'leave_type_id' => $data['leave_type_id'],
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'],
                'days_count' => $workingDays,
                'reason' => $data['reason'],
                'status' => 'pending',
                'document_path' => $data['document_path'] ?? null,
            ]);

            return $leaveRequest->load('leaveType', 'user');
        });

        // The requester is excluded: they just filed it.
        $this->announceToOrg($user->organization_id, $user->id, OrgActivity::leaveApplied(
            employeeName: $user->name,
            type: $created->leaveType?->name ?? 'Leave',
            dates: $this->describeRange($created->start_date, $created->end_date),
            days: (float) $created->days_count,
            requestId: $created->id,
        ));

        return $created;
    }

    /** "12 Mar 2026", or "12–15 Mar 2026" when it spans more than one day. */
    private function describeRange($start, $end): string
    {
        $from = Carbon::parse($start);
        $to = Carbon::parse($end);

        if ($from->isSameDay($to)) {
            return $from->format('d M Y');
        }

        return $from->isSameMonth($to)
            ? $from->format('d') . '–' . $to->format('d M Y')
            : $from->format('d M') . ' – ' . $to->format('d M Y');
    }

    /**
     * Update a PENDING leave request (dates, type, reason, half-day).
     *
     * Only the requester may edit their own request (LeaveRequestPolicy), and
     * only while pending — an approved request has already moved days into
     * used_days, so editing it would corrupt the balance.
     *
     * Balance handling: the old reservation is released and the new one taken
     * inside one transaction, so the type or even the year can change safely.
     * A failed availability check throws and rolls the release back too.
     */
    public function updateLeave(LeaveRequest $request, array $data): LeaveRequest
    {
        $orgId = $request->organization_id;
        $startDate = Carbon::parse($data['start_date']);
        $endDate = Carbon::parse($data['end_date']);
        $halfDay = (bool) ($data['half_day'] ?? false);

        // Overlap check against the user's OTHER requests — this one must not
        // collide with itself.
        $overlap = LeaveRequest::where('user_id', $request->user_id)
            ->where('id', '!=', $request->id)
            ->whereIn('status', ['pending', 'approved'])
            ->where('start_date', '<=', $endDate)
            ->where('end_date', '>=', $startDate)
            ->exists();

        if ($overlap) {
            throw new LeaveOverlapException();
        }

        $workingDays = $this->calculateWorkingDays($startDate, $endDate, $orgId, $halfDay);

        return DB::transaction(function () use ($request, $data, $orgId, $startDate, $workingDays) {
            $user = $request->user;

            // Release the reservation this request currently holds.
            $oldBalance = LeaveBalance::where('user_id', $request->user_id)
                ->where('leave_type_id', $request->leave_type_id)
                ->where('year', $request->start_date->year)
                ->lockForUpdate()
                ->first();

            if ($oldBalance) {
                $oldBalance->decrement('pending_days', $request->days_count);
            }

            // Reserve on the target balance (same row when type+year unchanged —
            // the release above already freed the old days, so the availability
            // check below is against the true remainder).
            $year = $startDate->year;
            $balance = LeaveBalance::where('user_id', $request->user_id)
                ->where('leave_type_id', $data['leave_type_id'])
                ->where('year', $year)
                ->lockForUpdate()
                ->first();

            if (! $balance) {
                $this->initializeBalances($user, $orgId, $year);
                $balance = LeaveBalance::where('user_id', $request->user_id)
                    ->where('leave_type_id', $data['leave_type_id'])
                    ->where('year', $year)
                    ->lockForUpdate()
                    ->first();
            }

            if (! $balance) {
                throw new InsufficientLeaveBalanceException('No leave balance found for this leave type.');
            }

            $balance->refresh();
            $available = $balance->total_days + $balance->carried_over_days - $balance->used_days - $balance->pending_days;

            if ($available < $workingDays) {
                throw new InsufficientLeaveBalanceException(
                    "Insufficient leave balance. Available: {$available} days, Requested: {$workingDays} days."
                );
            }

            $balance->increment('pending_days', $workingDays);

            $request->update([
                'leave_type_id' => $data['leave_type_id'],
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'],
                'days_count' => $workingDays,
                'reason' => $data['reason'],
            ]);

            return $request->fresh()->load('leaveType', 'user');
        });
    }

    /**
     * Approve a leave request. Moves pending_days to used_days on the balance.
     */
    public function approveLeave(LeaveRequest $request, User $approver): LeaveRequest
    {
        $fresh = DB::transaction(function () use ($request, $approver) {
            $balance = LeaveBalance::where('user_id', $request->user_id)
                ->where('leave_type_id', $request->leave_type_id)
                ->where('year', $request->start_date->year)
                ->lockForUpdate()
                ->firstOrFail();

            $balance->decrement('pending_days', $request->days_count);
            $balance->increment('used_days', $request->days_count);

            $request->update([
                'status' => 'approved',
                'approved_by' => $approver->id,
                'approved_at' => now(),
            ]);

            return $request->fresh()->load('leaveType', 'user', 'approver');
        });

        $this->announceResolution($fresh, true);

        return $fresh;
    }

    /**
     * Reject a leave request. Restores pending_days on the balance.
     */
    public function rejectLeave(LeaveRequest $request, User $approver, string $reason): LeaveRequest
    {
        $fresh = DB::transaction(function () use ($request, $approver, $reason) {
            $balance = LeaveBalance::where('user_id', $request->user_id)
                ->where('leave_type_id', $request->leave_type_id)
                ->where('year', $request->start_date->year)
                ->lockForUpdate()
                ->firstOrFail();

            $balance->decrement('pending_days', $request->days_count);

            $request->update([
                'status' => 'rejected',
                'approved_by' => $approver->id,
                'approved_at' => now(),
                'rejection_reason' => $reason,
            ]);

            return $request->fresh()->load('leaveType', 'user', 'approver');
        });

        $this->announceResolution($fresh, false, $reason);

        return $fresh;
    }

    /**
     * Tell the requester what was decided.
     *
     * After the commit and never able to fail the decision: the leave IS
     * approved once the row is written, and a queue that is down must not turn
     * that into an error the approver has to retry.
     *
     * The approver is not told — they just pressed the button. When someone
     * resolves their OWN request (which LeaveService already refuses, but a
     * custom flow might allow) the guard still holds: notifying yourself about
     * your own action is noise.
     */
    private function announceResolution(LeaveRequest $request, bool $approved, ?string $reason = null): void
    {
        try {
            $employee = $request->relationLoaded('user') ? $request->user : $request->user()->first();

            if (! $employee || $employee->id === $request->approved_by) {
                return;
            }

            $employee->notify(new LeaveResolved($request, $approved, $reason));
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * Cancel a leave request.
     * If status=pending: restore pending_days. If status=approved: restore used_days.
     * Only requester or admin can cancel.
     */
    public function cancelLeave(LeaveRequest $request, User $user): LeaveRequest
    {
        return DB::transaction(function () use ($request) {
            $balance = LeaveBalance::where('user_id', $request->user_id)
                ->where('leave_type_id', $request->leave_type_id)
                ->where('year', $request->start_date->year)
                ->lockForUpdate()
                ->firstOrFail();

            if ($request->status === 'pending') {
                $balance->decrement('pending_days', $request->days_count);
            } elseif ($request->status === 'approved') {
                $balance->decrement('used_days', $request->days_count);
            }

            $request->update(['status' => 'cancelled']);

            return $request->fresh()->load('leaveType', 'user');
        });
    }

    /**
     * Calculate working days between two dates, excluding weekends and org public holidays.
     * Half-day: if start_date === end_date and halfDay = true, returns 0.5
     */
    public function calculateWorkingDays(Carbon $start, Carbon $end, string $orgId, bool $halfDay = false): float
    {
        if ($halfDay && $start->isSameDay($end)) {
            return 0.5;
        }

        // Get public holidays for the org in the date range
        $holidays = PublicHoliday::where('organization_id', $orgId)
            ->whereBetween('date', [$start->toDateString(), $end->toDateString()])
            ->pluck('date')
            ->map(fn ($d) => Carbon::parse($d)->toDateString())
            ->toArray();

        $workingDays = 0;
        $current = $start->copy();

        while ($current->lte($end)) {
            // Skip weekends (Saturday = 6, Sunday = 0)
            if (! $current->isWeekend() && ! in_array($current->toDateString(), $holidays)) {
                $workingDays++;
            }
            $current->addDay();
        }

        return (float) $workingDays;
    }

    /**
     * Get team leave calendar for a given month/year.
     * Returns leave requests with user details for the given period.
     *
     * Role-based scoping:
     * - Employee: sees only their own leave requests
     * - Manager: sees their own + managed team members' requests
     * - Admin/Owner: sees all org leave requests
     */
    public function getLeaveCalendar(string $orgId, int $month, int $year, ?User $viewer = null): array
    {
        $startOfMonth = Carbon::create($year, $month, 1)->startOfMonth();
        $endOfMonth = $startOfMonth->copy()->endOfMonth();

        $query = LeaveRequest::where('organization_id', $orgId)
            ->whereIn('status', ['approved', 'pending'])
            ->where('start_date', '<=', $endOfMonth)
            ->where('end_date', '>=', $startOfMonth)
            ->with(['user:id,name,email,avatar_url', 'leaveType:id,name,code']);

        // Role-based scoping when viewer is provided
        if ($viewer !== null) {
            if ($viewer->hasRole('owner', 'org_manager', 'hr_manager', 'finance_manager')) {
                // Owner/admin see all org leave requests
            } elseif ($viewer->isManager()) {
                // Managers see their own + their project members' requests
                $projectMemberIds = $this->permissionService->getProjectUserIds($viewer);
                $query->whereIn('user_id', $projectMemberIds);
            } else {
                // Employees see only their own leave requests
                $query->where('user_id', $viewer->id);
            }
        }

        $requests = $query->get();

        // Group by date
        $calendar = [];
        foreach ($requests as $request) {
            $current = Carbon::parse($request->start_date)->max($startOfMonth);
            $end = Carbon::parse($request->end_date)->min($endOfMonth);
            $isHalfDay = $request->days_count == 0.5;

            while ($current->lte($end)) {
                $dateStr = $current->toDateString();
                $calendar[$dateStr][] = [
                    'id' => $request->id,
                    'user' => $request->user,
                    'user_name' => $request->user?->name,
                    'leave_type' => $request->leaveType,
                    'leave_type_name' => $request->leaveType?->name,
                    'leave_type_code' => $request->leaveType?->code,
                    'status' => $request->status,
                    'days_count' => $request->days_count,
                    'half_day' => $isHalfDay,
                    'start_date' => $request->start_date->toDateString(),
                    'end_date' => $request->end_date->toDateString(),
                ];
                $current->addDay();
            }
        }

        return $calendar;
    }

    /**
     * Initialize leave balances for a user for a given year.
     * Creates LeaveBalance records for all active LeaveTypes in the org.
     * Skips if balance already exists (idempotent).
     */
    public function initializeBalances(User $user, string $orgId, int $year): void
    {
        $leaveTypes = LeaveType::where('organization_id', $orgId)
            ->where('is_active', true)
            ->get();

        foreach ($leaveTypes as $leaveType) {
            LeaveBalance::firstOrCreate(
                [
                    'organization_id' => $orgId,
                    'user_id' => $user->id,
                    'leave_type_id' => $leaveType->id,
                    'year' => $year,
                ],
                [
                    'total_days' => $leaveType->days_per_year,
                    'used_days' => 0,
                    'pending_days' => 0,
                    'carried_over_days' => 0,
                ],
            );
        }
    }
}
