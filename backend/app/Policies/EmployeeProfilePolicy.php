<?php

namespace App\Policies;

use App\Models\EmployeeProfile;
use App\Models\User;
use App\Services\PermissionService;

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
     * Same org AND (self OR has employees.edit_profile at org scope).
     */
    public function update(User $user, EmployeeProfile $profile): bool
    {
        if ($user->organization_id !== $profile->organization_id) {
            return false;
        }

        // Users can always edit their own profile (personal fields — enforced in service layer)
        if ($user->id === $profile->user_id) {
            return true;
        }

        return app(PermissionService::class)->hasPermission($user, 'employees.edit_profile', 'organization');
    }

    /**
     * Users with employees.view_financial permission can view financial fields unmasked.
     */
    public function viewFinancial(User $user, EmployeeProfile $profile): bool
    {
        if ($user->organization_id !== $profile->organization_id) {
            return false;
        }

        // Own profile — users can view their own financial data
        if ($user->id === $profile->user_id) {
            return true;
        }

        return app(PermissionService::class)->hasPermission($user, 'employees.view_financial', 'organization');
    }
}
