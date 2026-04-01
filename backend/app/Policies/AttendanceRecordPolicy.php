<?php

namespace App\Policies;

use App\Models\AttendanceRecord;
use App\Models\User;

class AttendanceRecordPolicy
{
    /**
     * Any authenticated user can view their own attendance records.
     */
    public function viewOwn(User $user): bool
    {
        return true;
    }

    /**
     * Manager/admin/owner can view team attendance.
     */
    public function viewTeam(User $user): bool
    {
        return $user->hasRole('owner', 'admin', 'manager');
    }

    /**
     * User can regularize their own record, except on_leave or holiday.
     */
    public function regularize(User $user, AttendanceRecord $record): bool
    {
        if ($user->organization_id !== $record->organization_id) {
            return false;
        }

        if ($user->id !== $record->user_id) {
            return false;
        }

        return !in_array($record->status, ['on_leave', 'holiday']);
    }

    /**
     * Admin/owner can trigger generation, edit overtime rules, etc.
     */
    public function manage(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }
}
