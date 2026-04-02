<?php

namespace App\Policies;

use App\Models\ShiftSwapRequest;
use App\Models\User;

class ShiftSwapRequestPolicy
{
    /**
     * Any authenticated org member can view swap requests (scoping in service layer).
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Any authenticated org member can create a swap request.
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * Owner/admin/manager can approve, but NOT their own request (anti-self-approval).
     */
    public function approve(User $user, ShiftSwapRequest $swap): bool
    {
        if ($user->organization_id !== $swap->organization_id) {
            return false;
        }

        // Prevent self-approval
        if ($user->id === $swap->requester_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager');
    }

    /**
     * Requester can delete (cancel) when status is pending, OR owner/admin can delete any.
     */
    public function delete(User $user, ShiftSwapRequest $swap): bool
    {
        if ($user->organization_id !== $swap->organization_id) {
            return false;
        }

        // Owner/admin can delete any swap request
        if ($user->hasRole('owner', 'admin')) {
            return true;
        }

        // Requester can cancel their own pending request
        return $user->id === $swap->requester_id && $swap->status === 'pending';
    }
}
