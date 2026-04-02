<?php

namespace App\Policies;

use App\Models\EmployeeSalaryAssignment;
use App\Models\User;
use App\Services\PermissionService;

class EmployeeSalaryAssignmentPolicy
{
    /**
     * View salary assignment: admin can view all, employee can view own.
     */
    public function view(User $user, string $employeeId = null): bool
    {
        // Own salary
        if ($employeeId && $user->id === $employeeId) {
            return app(PermissionService::class)->hasPermission($user, 'payroll.view_own');
        }

        return app(PermissionService::class)->hasPermission($user, 'payroll.view_all')
            || app(PermissionService::class)->hasPermission($user, 'payroll.manage_structures');
    }

    /**
     * Only admins with manage_structures can assign salaries.
     */
    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.manage_structures');
    }
}
