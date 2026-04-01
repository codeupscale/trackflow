<?php

namespace App\Policies;

use App\Models\PublicHoliday;
use App\Models\User;
use App\Services\PermissionService;

class PublicHolidayPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, PublicHoliday $publicHoliday): bool
    {
        return $user->organization_id === $publicHoliday->organization_id;
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'leave.manage_holidays');
    }

    public function update(User $user, PublicHoliday $publicHoliday): bool
    {
        if ($user->organization_id !== $publicHoliday->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'leave.manage_holidays');
    }

    public function delete(User $user, PublicHoliday $publicHoliday): bool
    {
        if ($user->organization_id !== $publicHoliday->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'leave.manage_holidays');
    }
}
