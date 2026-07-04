<?php

namespace App\Policies;

use App\Models\User;
use App\Services\PermissionService;

class AttendancePolicyPolicy
{
    /**
     * Anyone who can view attendance can read the policy (the check-in UI needs
     * the window times to render).
     */
    public function view(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'attendance.view');
    }

    /**
     * Only users with attendance.manage_policy may change the policy.
     */
    public function update(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'attendance.manage_policy');
    }

    /**
     * Alias used by the controller's authorize('managePolicy', ...) call.
     */
    public function managePolicy(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'attendance.manage_policy');
    }
}
