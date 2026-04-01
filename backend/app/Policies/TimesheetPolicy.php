<?php

namespace App\Policies;

use App\Models\Timesheet;
use App\Models\User;
use App\Services\PermissionService;

class TimesheetPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Timesheet $timesheet): bool
    {
        if ($user->organization_id !== $timesheet->organization_id) {
            return false;
        }

        // Own timesheet
        if ($user->id === $timesheet->user_id) {
            return true;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'time_entries.view');

        if ($scope === 'organization') {
            return true;
        }

        if ($scope === 'team') {
            return in_array($timesheet->user_id, $service->getTeamUserIds($user));
        }

        return false;
    }

    public function submit(User $user, Timesheet $timesheet): bool
    {
        return $user->organization_id === $timesheet->organization_id
            && $user->id === $timesheet->user_id;
    }

    public function review(User $user, Timesheet $timesheet): bool
    {
        if ($user->organization_id !== $timesheet->organization_id) {
            return false;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'time_entries.approve');

        if ($scope === null) {
            return false;
        }

        if ($scope === 'organization') {
            return true;
        }

        if ($scope === 'team') {
            return in_array($timesheet->user_id, $service->getTeamUserIds($user));
        }

        return false;
    }
}
