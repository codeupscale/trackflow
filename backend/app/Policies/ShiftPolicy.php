<?php

namespace App\Policies;

use App\Models\Shift;
use App\Models\User;

class ShiftPolicy
{
    /**
     * Any authenticated org member can view shifts.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Any member of the same org can view a shift.
     */
    public function view(User $user, Shift $shift): bool
    {
        return $user->organization_id === $shift->organization_id;
    }

    /**
     * Only owner or admin can create shifts.
     */
    public function create(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }

    /**
     * Only owner or admin can update shifts (same org check).
     */
    public function update(User $user, Shift $shift): bool
    {
        if ($user->organization_id !== $shift->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }

    /**
     * Only owner or admin can delete shifts (same org check).
     */
    public function delete(User $user, Shift $shift): bool
    {
        if ($user->organization_id !== $shift->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }

    /**
     * Owner, admin, or manager can manage shift assignments.
     */
    public function manage(User $user, Shift $shift): bool
    {
        if ($user->organization_id !== $shift->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager');
    }
}
