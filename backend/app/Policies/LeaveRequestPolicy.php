<?php

namespace App\Policies;

use App\Models\LeaveRequest;
use App\Models\User;

class LeaveRequestPolicy
{
    /**
     * Any authenticated org member can view the list (scoping is done in controller).
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Own request, OR manager of requester's team, OR admin/owner.
     */
    public function view(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        // Own request
        if ($user->id === $leaveRequest->user_id) {
            return true;
        }

        // Admin or owner
        if ($user->hasRole('owner', 'admin')) {
            return true;
        }

        // Manager — can view team members' requests
        if ($user->isManager()) {
            return $user->managedTeams()
                ->whereHas('members', fn ($q) => $q->where('users.id', $leaveRequest->user_id))
                ->exists();
        }

        return false;
    }

    /**
     * Any authenticated org member can create a leave request.
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * Only admin/owner can edit a submitted request.
     */
    public function update(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }

    /**
     * Admin/owner or manager can approve, but NOT their own request.
     * Self-approval would bypass oversight — a manager cannot approve leave they submitted.
     */
    public function approve(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        // Prevent self-approval: no one can approve their own leave request
        if ($user->id === $leaveRequest->user_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager');
    }

    /**
     * Own request with status pending/approved, OR admin/owner.
     */
    public function delete(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        // Admin/owner can cancel any request
        if ($user->hasRole('owner', 'admin')) {
            return in_array($leaveRequest->status, ['pending', 'approved']);
        }

        // Own request, only if pending or approved
        return $user->id === $leaveRequest->user_id
            && in_array($leaveRequest->status, ['pending', 'approved']);
    }
}
