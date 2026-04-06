<?php

namespace App\Policies;

use App\Models\PayComponent;
use App\Models\User;
use App\Services\PermissionService;

class PayComponentPolicy
{
    public function viewAny(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.manage_components')
            || app(PermissionService::class)->hasPermission($user, 'payroll.view_all');
    }

    public function view(User $user, PayComponent $component): bool
    {
        return $user->organization_id === $component->organization_id
            && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.manage_components');
    }

    public function update(User $user, PayComponent $component): bool
    {
        return $user->organization_id === $component->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.manage_components');
    }

    public function delete(User $user, PayComponent $component): bool
    {
        return $user->organization_id === $component->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.manage_components');
    }
}
