<?php

namespace App\Policies;

use App\Models\Screenshot;
use App\Models\User;
use App\Services\PermissionService;

class ScreenshotPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Screenshot $screenshot): bool
    {
        if ($user->organization_id !== $screenshot->organization_id) {
            return false;
        }

        // Own screenshot
        if ($user->id === $screenshot->user_id) {
            return true;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'screenshots.view');

        if ($scope === 'organization') {
            return true;
        }

        if (($scope === 'project')) {
            return in_array($screenshot->user_id, $service->getProjectUserIds($user));
        }

        return false;
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function delete(User $user, Screenshot $screenshot): bool
    {
        // Screenshot deletion is disabled system-wide. No user — regardless of
        // role or the screenshots.delete permission — may delete a screenshot.
        return false;
    }
}
