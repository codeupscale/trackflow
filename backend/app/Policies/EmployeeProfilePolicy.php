<?php

namespace App\Policies;

use App\Models\EmployeeProfile;
use App\Models\User;

class EmployeeProfilePolicy
{
    /**
     * All org members can see the employee directory.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Same org can view a profile.
     */
    public function view(User $user, EmployeeProfile $profile): bool
    {
        return $user->organization_id === $profile->organization_id;
    }

    /**
     * Same org AND (self OR admin/owner) can update.
     */
    public function update(User $user, EmployeeProfile $profile): bool
    {
        if ($user->organization_id !== $profile->organization_id) {
            return false;
        }

        return $user->id === $profile->user_id || $user->hasRole('owner', 'admin');
    }

    /**
     * Only admin/owner can view financial fields unmasked.
     */
    public function viewFinancial(User $user, EmployeeProfile $profile): bool
    {
        if ($user->organization_id !== $profile->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }
}
