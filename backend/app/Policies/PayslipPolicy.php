<?php

namespace App\Policies;

use App\Models\Payslip;
use App\Models\User;
use App\Services\PermissionService;

class PayslipPolicy
{
    /**
     * Any authenticated user can view the payslip list —
     * role-scoped filtering is done in PayrollService::getPayslips().
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Employee can view own payslip.
     * Manager can view team payslips.
     * Admin/accountant can view all.
     */
    public function view(User $user, Payslip $payslip): bool
    {
        if ($user->organization_id !== $payslip->organization_id) {
            return false;
        }

        // Own payslip
        if ($user->id === $payslip->user_id) {
            return true;
        }

        $service = app(PermissionService::class);

        // Admin/accountant: view all
        if ($service->hasPermission($user, 'payroll.view_all')) {
            return true;
        }

        // Manager: view team
        if ($service->hasPermission($user, 'payroll.view_team')) {
            return in_array($payslip->user_id, $service->getTeamUserIds($user));
        }

        return false;
    }
}
