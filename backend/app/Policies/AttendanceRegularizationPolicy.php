<?php

namespace App\Policies;

use App\Models\AttendanceRegularization;
use App\Models\User;
use App\Services\PermissionService;

class AttendanceRegularizationPolicy
{
    /**
     * Users with attendance.approve_regularizations can approve (not their own).
     */
    public function approve(User $user, AttendanceRegularization $reg): bool
    {
        if ($user->organization_id !== $reg->organization_id) {
            return false;
        }

        // Cannot approve own regularization
        if ($user->id === $reg->user_id) {
            return false;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'attendance.approve_regularizations');

        if ($scope === null) {
            return false;
        }

        if ($scope === 'organization') {
            return true;
        }

        if ($scope === 'team') {
            return in_array($reg->user_id, $service->getTeamUserIds($user));
        }

        return false;
    }
}
