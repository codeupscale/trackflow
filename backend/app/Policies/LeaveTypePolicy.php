<?php

namespace App\Policies;

use App\Models\User;
use App\Services\PermissionService;

class LeaveTypePolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'leave.manage_types');
    }
}
