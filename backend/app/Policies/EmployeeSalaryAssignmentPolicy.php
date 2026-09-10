<?php

namespace App\Policies;

use App\Models\EmployeeSalaryAssignment;
use App\Models\User;
use App\Services\PermissionService;

class EmployeeSalaryAssignmentPolicy
{
    /**
     * The salary ROSTER exposes every employee's pay, so it is admin-only —
     * deliberately not reachable via payroll.view_own, unlike view().
     */
    public function viewAny(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.view_all')
            || app(PermissionService::class)->hasPermission($user, 'payroll.manage_structures');
    }

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
