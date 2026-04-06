<?php

namespace App\Policies;

use App\Models\SalaryStructure;
use App\Models\User;
use App\Services\PermissionService;

class SalaryStructurePolicy
{
    public function viewAny(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.manage_structures')
            || app(PermissionService::class)->hasPermission($user, 'payroll.view_all');
    }

    public function view(User $user, SalaryStructure $structure): bool
    {
        return $user->organization_id === $structure->organization_id
            && $this->viewAny($user);
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.manage_structures');
    }

    public function update(User $user, SalaryStructure $structure): bool
    {
        return $user->organization_id === $structure->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.manage_structures');
    }

    public function delete(User $user, SalaryStructure $structure): bool
    {
        return $user->organization_id === $structure->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.manage_structures');
    }
}
