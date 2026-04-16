<?php

namespace App\Policies;

use App\Models\User;
use App\Services\PermissionService;

class AppUsageSummaryPolicy
{
    /**
     * View daily app usage for a specific user.
     * Own data is always visible. Viewing another user's data requires reports.view with team+ scope.
     */
    public function viewDaily(User $authUser, ?string $targetUserId = null): bool
    {
        // Own data — always allowed
        if ($targetUserId === null || $targetUserId === $authUser->id) {
            return true;
        }

        // Viewing another user's data requires team-level reports permission
        return app(PermissionService::class)->hasPermission($authUser, 'reports.view', 'team');
    }

    /**
     * View team-wide app usage summary. Requires team+ scope on reports.view.
     */
    public function viewTeam(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'reports.view', 'team');
    }

    /**
     * View org-wide top apps. Requires organization scope on reports.view.
     */
    public function viewTop(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'reports.view', 'organization');
    }
}
