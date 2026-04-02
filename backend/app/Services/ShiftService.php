<?php

namespace App\Services;

use App\Models\Shift;
use App\Models\ShiftSwapRequest;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ShiftService
{
    // ─── Shift CRUD ──────────────────────────────────────────────

    /**
     * List shifts for an organization, filterable by is_active, searchable by name.
     */
    public function listShifts(string $orgId, array $filters): LengthAwarePaginator
    {
        $query = Shift::where('organization_id', $orgId);

        if (isset($filters['is_active'])) {
            $query->where('is_active', filter_var($filters['is_active'], FILTER_VALIDATE_BOOLEAN));
        }

        if (! empty($filters['search'])) {
            $search = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $filters['search']);
            $query->where('name', 'ilike', '%' . $search . '%');
        }

        return $query->orderBy('name')->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Create a new shift.
     */
    public function createShift(string $orgId, array $data): Shift
    {
        return Shift::create(array_merge($data, [
            'organization_id' => $orgId,
        ]));
    }

    /**
     * Update an existing shift.
     */
    public function updateShift(Shift $shift, array $data): Shift
    {
        $shift->update($data);

        return $shift->fresh();
    }

    /**
     * Soft-delete a shift and end all active assignments.
     */
    public function deleteShift(Shift $shift): void
    {
        DB::transaction(function () use ($shift) {
            // End all active assignments: set effective_to = today
            DB::table('user_shifts')
                ->where('shift_id', $shift->id)
                ->where('organization_id', $shift->organization_id)
                ->where(function ($q) {
                    $q->whereNull('effective_to')
                        ->orWhere('effective_to', '>=', now()->toDateString());
                })
                ->whereNull('deleted_at')
                ->update(['effective_to' => now()->toDateString()]);

            $shift->delete();
        });
    }

    /**
     * Get a single shift with its active users.
     */
    public function getShift(string $orgId, string $shiftId): Shift
    {
        return Shift::where('organization_id', $orgId)
            ->with('activeUsers:id,name,email,avatar_url')
            ->findOrFail($shiftId);
    }

    // ─── Assignments ─────────────────────────────────────────────

    /**
     * Assign a user to a shift. Validates no overlapping active assignment.
     */
    public function assignUser(string $orgId, string $userId, string $shiftId, string $effectiveFrom, ?string $effectiveTo): void
    {
        // Validate user belongs to org
        $userExists = DB::table('users')
            ->where('id', $userId)
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->exists();

        if (! $userExists) {
            abort(422, 'User does not belong to this organization.');
        }

        // Check for overlapping active assignment for this user
        $overlap = DB::table('user_shifts')
            ->where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->where('effective_from', '<=', $effectiveTo ?? '9999-12-31')
            ->where(function ($q) use ($effectiveFrom) {
                $q->whereNull('effective_to')
                    ->orWhere('effective_to', '>=', $effectiveFrom);
            })
            ->exists();

        if ($overlap) {
            abort(422, 'User already has an active shift assignment that overlaps with the specified period.');
        }

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $orgId,
            'user_id' => $userId,
            'shift_id' => $shiftId,
            'effective_from' => $effectiveFrom,
            'effective_to' => $effectiveTo,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Unassign a user from a shift by ending the active pivot row.
     */
    public function unassignUser(string $orgId, string $userId, string $shiftId): void
    {
        $updated = DB::table('user_shifts')
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->where('shift_id', $shiftId)
            ->whereNull('deleted_at')
            ->where(function ($q) {
                $q->whereNull('effective_to')
                    ->orWhere('effective_to', '>=', now()->toDateString());
            })
            ->update(['effective_to' => now()->toDateString()]);

        if ($updated === 0) {
            abort(422, 'No active assignment found for this user on this shift.');
        }
    }

    /**
     * Bulk-assign multiple users to a shift. Returns count of successful assignments.
     */
    public function bulkAssign(string $orgId, string $shiftId, array $userIds, string $effectiveFrom, ?string $effectiveTo): int
    {
        return DB::transaction(function () use ($orgId, $shiftId, $userIds, $effectiveFrom, $effectiveTo) {
            $count = 0;
            foreach ($userIds as $userId) {
                $this->assignUser($orgId, $userId, $shiftId, $effectiveFrom, $effectiveTo);
                $count++;
            }

            return $count;
        });
    }

    /**
     * Paginate users assigned to a shift with pivot data.
     */
    public function getShiftAssignments(string $orgId, string $shiftId): LengthAwarePaginator
    {
        $shift = Shift::where('organization_id', $orgId)->findOrFail($shiftId);

        return $shift->activeUsers()
            ->select('users.id', 'users.name', 'users.email', 'users.avatar_url')
            ->paginate(25);
    }

    /**
     * Get the current (or date-specific) shift for a user.
     */
    public function getUserCurrentShift(string $orgId, string $userId, ?string $date = null): ?Shift
    {
        $targetDate = $date ?? now()->toDateString();

        return Shift::where('organization_id', $orgId)
            ->whereHas('users', function ($q) use ($userId, $targetDate) {
                $q->where('users.id', $userId)
                    ->where('user_shifts.effective_from', '<=', $targetDate)
                    ->where(function ($sq) use ($targetDate) {
                        $sq->whereNull('user_shifts.effective_to')
                            ->orWhere('user_shifts.effective_to', '>=', $targetDate);
                    });
            })
            ->first();
    }

    // ─── Roster ──────────────────────────────────────────────────

    /**
     * Get a 7-day shift roster starting from the given week start date.
     * Returns an array keyed by date, each containing shifts with their assigned users.
     */
    public function getShiftRoster(string $orgId, string $weekStart): array
    {
        $startDate = Carbon::parse($weekStart);
        $endDate = $startDate->copy()->addDays(6);

        // Get all shift assignments that overlap with this week
        $assignments = DB::table('user_shifts')
            ->join('shifts', 'shifts.id', '=', 'user_shifts.shift_id')
            ->join('users', 'users.id', '=', 'user_shifts.user_id')
            ->where('user_shifts.organization_id', $orgId)
            ->whereNull('user_shifts.deleted_at')
            ->whereNull('shifts.deleted_at')
            ->where('user_shifts.effective_from', '<=', $endDate->toDateString())
            ->where(function ($q) use ($startDate) {
                $q->whereNull('user_shifts.effective_to')
                    ->orWhere('user_shifts.effective_to', '>=', $startDate->toDateString());
            })
            ->select(
                'shifts.id as shift_id',
                'shifts.name as shift_name',
                'shifts.start_time',
                'shifts.end_time',
                'shifts.days_of_week',
                'shifts.color',
                'users.id as user_id',
                'users.name as user_name',
                'users.email as user_email',
                'users.avatar_url',
                'user_shifts.effective_from',
                'user_shifts.effective_to',
            )
            ->get();

        $roster = [];
        $current = $startDate->copy();

        while ($current->lte($endDate)) {
            $dateStr = $current->toDateString();
            $dayOfWeek = strtolower($current->format('l'));
            $roster[$dateStr] = [];

            // Group assignments by shift for this date
            $shiftGroups = [];

            foreach ($assignments as $assignment) {
                $daysOfWeek = json_decode($assignment->days_of_week, true) ?? [];

                // Check if this shift operates on this day of the week
                if (! in_array($dayOfWeek, $daysOfWeek)) {
                    continue;
                }

                // Check if assignment covers this specific date
                if ($assignment->effective_from > $dateStr) {
                    continue;
                }
                if ($assignment->effective_to && $assignment->effective_to < $dateStr) {
                    continue;
                }

                $shiftId = $assignment->shift_id;

                if (! isset($shiftGroups[$shiftId])) {
                    $shiftGroups[$shiftId] = [
                        'shift' => [
                            'id' => $assignment->shift_id,
                            'name' => $assignment->shift_name,
                            'start_time' => $assignment->start_time,
                            'end_time' => $assignment->end_time,
                            'color' => $assignment->color,
                        ],
                        'users' => [],
                    ];
                }

                $shiftGroups[$shiftId]['users'][] = [
                    'id' => $assignment->user_id,
                    'name' => $assignment->user_name,
                    'email' => $assignment->user_email,
                    'avatar_url' => $assignment->avatar_url,
                ];
            }

            $roster[$dateStr] = array_values($shiftGroups);
            $current->addDay();
        }

        return $roster;
    }

    // ─── Swap Requests ───────────────────────────────────────────

    /**
     * Create a shift swap request.
     * Validates: requester has shift, target has shift, not self-swap,
     * no duplicate pending, swap_date is future.
     */
    public function createSwapRequest(User $requester, array $data): ShiftSwapRequest
    {
        $orgId = $requester->organization_id;
        $swapDate = $data['swap_date'];

        // Validate not self-swap
        if ($requester->id === $data['target_user_id']) {
            abort(422, 'You cannot create a swap request with yourself.');
        }

        // Validate swap_date is in the future
        if (Carbon::parse($swapDate)->lte(Carbon::today())) {
            abort(422, 'Swap date must be in the future.');
        }

        // Get requester's active shift for swap date
        $requesterShift = $this->getUserCurrentShift($orgId, $requester->id, $swapDate);
        if (! $requesterShift) {
            abort(422, 'You do not have an active shift assignment for the requested date.');
        }

        // Validate target user belongs to same org
        $targetUser = User::where('organization_id', $orgId)->find($data['target_user_id']);
        if (! $targetUser) {
            abort(422, 'Target user does not belong to your organization.');
        }

        // Get target user's active shift for swap date
        $targetShift = $this->getUserCurrentShift($orgId, $data['target_user_id'], $swapDate);
        if (! $targetShift) {
            abort(422, 'Target user does not have an active shift assignment for the requested date.');
        }

        // Check for duplicate pending swap between same users on same date
        $duplicatePending = ShiftSwapRequest::where('organization_id', $orgId)
            ->where('status', 'pending')
            ->whereDate('swap_date', $swapDate)
            ->where(function ($q) use ($requester, $data) {
                $q->where(function ($sq) use ($requester, $data) {
                    $sq->where('requester_id', $requester->id)
                        ->where('target_user_id', $data['target_user_id']);
                })->orWhere(function ($sq) use ($requester, $data) {
                    $sq->where('requester_id', $data['target_user_id'])
                        ->where('target_user_id', $requester->id);
                });
            })
            ->exists();

        if ($duplicatePending) {
            abort(422, 'A pending swap request already exists between these users for this date.');
        }

        return ShiftSwapRequest::create([
            'organization_id' => $orgId,
            'requester_id' => $requester->id,
            'target_user_id' => $data['target_user_id'],
            'requester_shift_id' => $requesterShift->id,
            'target_shift_id' => $targetShift->id,
            'swap_date' => $swapDate,
            'reason' => $data['reason'] ?? null,
            'status' => 'pending',
        ]);
    }

    /**
     * Approve a swap request. Creates single-day pivot overrides in a transaction.
     * Self-approval is prevented: reviewer cannot be the requester.
     */
    public function approveSwap(ShiftSwapRequest $swap, User $reviewer): ShiftSwapRequest
    {
        if ($reviewer->id === $swap->requester_id) {
            abort(403, 'You cannot approve your own swap request.');
        }

        return DB::transaction(function () use ($swap, $reviewer) {
            $swapDate = $swap->swap_date->toDateString();

            // Create single-day pivot override: requester gets target's shift
            DB::table('user_shifts')->insert([
                'id' => (string) Str::uuid(),
                'organization_id' => $swap->organization_id,
                'user_id' => $swap->requester_id,
                'shift_id' => $swap->target_shift_id,
                'effective_from' => $swapDate,
                'effective_to' => $swapDate,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            // Create single-day pivot override: target user gets requester's shift
            DB::table('user_shifts')->insert([
                'id' => (string) Str::uuid(),
                'organization_id' => $swap->organization_id,
                'user_id' => $swap->target_user_id,
                'shift_id' => $swap->requester_shift_id,
                'effective_from' => $swapDate,
                'effective_to' => $swapDate,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $swap->update([
                'status' => 'approved',
                'reviewed_by' => $reviewer->id,
                'reviewed_at' => now(),
            ]);

            return $swap->fresh()->load([
                'requester:id,name,email',
                'targetUser:id,name,email',
                'requesterShift:id,name,start_time,end_time',
                'targetShift:id,name,start_time,end_time',
                'reviewer:id,name,email',
            ]);
        });
    }

    /**
     * Reject a swap request.
     */
    public function rejectSwap(ShiftSwapRequest $swap, User $reviewer, ?string $note): ShiftSwapRequest
    {
        $swap->update([
            'status' => 'rejected',
            'reviewed_by' => $reviewer->id,
            'reviewed_at' => now(),
            'reviewer_note' => $note,
        ]);

        return $swap->fresh()->load([
            'requester:id,name,email',
            'targetUser:id,name,email',
            'requesterShift:id,name,start_time,end_time',
            'targetShift:id,name,start_time,end_time',
            'reviewer:id,name,email',
        ]);
    }

    /**
     * Cancel a swap request. Only allowed if pending.
     */
    public function cancelSwap(ShiftSwapRequest $swap): ShiftSwapRequest
    {
        if ($swap->status !== 'pending') {
            abort(422, 'Only pending swap requests can be cancelled.');
        }

        $swap->update(['status' => 'cancelled']);

        return $swap->fresh();
    }

    /**
     * List swap requests with role-based scoping.
     * Employees see own requests, managers see team, admins see all.
     */
    public function listSwapRequests(string $orgId, User $user, array $filters): LengthAwarePaginator
    {
        $query = ShiftSwapRequest::where('organization_id', $orgId)
            ->with([
                'requester:id,name,email,avatar_url',
                'targetUser:id,name,email,avatar_url',
                'requesterShift:id,name,start_time,end_time,color',
                'targetShift:id,name,start_time,end_time,color',
                'reviewer:id,name,email',
            ]);

        // Role-based scoping
        if ($user->hasRole('owner', 'admin')) {
            // Owner/admin see all org swap requests
        } elseif ($user->isManager()) {
            // Managers see their own + team members' requests
            $teamMemberIds = $user->managedTeams()
                ->with('members:id')
                ->get()
                ->flatMap(fn ($team) => $team->members->pluck('id'))
                ->push($user->id)
                ->unique()
                ->values();

            $query->where(function ($q) use ($teamMemberIds) {
                $q->whereIn('requester_id', $teamMemberIds)
                    ->orWhereIn('target_user_id', $teamMemberIds);
            });
        } else {
            // Employees see only their own requests (as requester or target)
            $query->where(function ($q) use ($user) {
                $q->where('requester_id', $user->id)
                    ->orWhere('target_user_id', $user->id);
            });
        }

        // Filter by status
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query->orderByDesc('created_at')->paginate($filters['per_page'] ?? 25);
    }
}
