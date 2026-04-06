<?php

namespace App\Policies;

use App\Models\PayrollPeriod;
use App\Models\User;
use App\Services\PermissionService;

class PayrollPeriodPolicy
{
    public function viewAny(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.view_all');
    }

    public function view(User $user, PayrollPeriod $period): bool
    {
        return $user->organization_id === $period->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.view_all');
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'payroll.run');
    }

    public function update(User $user, PayrollPeriod $period): bool
    {
        return $user->organization_id === $period->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.run');
    }

    public function delete(User $user, PayrollPeriod $period): bool
    {
        return $user->organization_id === $period->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.run');
    }

    public function run(User $user, PayrollPeriod $period): bool
    {
        return $user->organization_id === $period->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.run');
    }

    public function approve(User $user, PayrollPeriod $period): bool
    {
        return $user->organization_id === $period->organization_id
            && app(PermissionService::class)->hasPermission($user, 'payroll.approve');
    }
}
