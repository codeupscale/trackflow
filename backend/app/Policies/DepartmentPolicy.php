<?php

namespace App\Policies;

use App\Models\Department;
use App\Models\User;
use App\Services\PermissionService;

class DepartmentPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Department $department): bool
    {
        return $user->organization_id === $department->organization_id;
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'departments.create');
    }

    public function update(User $user, Department $department): bool
    {
        if ($user->organization_id !== $department->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'departments.edit');
    }

    public function delete(User $user, Department $department): bool
    {
        if ($user->organization_id !== $department->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'departments.delete');
    }
}
