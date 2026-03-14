<?php

namespace App\Policies;

use App\Models\Timesheet;
use App\Models\User;

class TimesheetPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Timesheet $timesheet): bool
    {
        if ($user->organization_id !== $timesheet->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager') || $user->id === $timesheet->user_id;
    }

    public function submit(User $user, Timesheet $timesheet): bool
    {
        return $user->organization_id === $timesheet->organization_id
            && $user->id === $timesheet->user_id;
    }

    public function review(User $user, Timesheet $timesheet): bool
    {
        if ($user->organization_id !== $timesheet->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager');
    }
}
