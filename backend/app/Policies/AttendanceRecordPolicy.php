<?php

namespace App\Policies;

use App\Models\AttendanceRecord;
use App\Models\User;
use App\Services\PermissionService;

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
     * Users with attendance.view at project or org scope can view team attendance.
     */
    public function viewTeam(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'attendance.view', 'project');
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
     * Users with attendance.generate permission can trigger generation, manage rules, etc.
     */
    public function manage(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'attendance.generate');
    }

    /**
     * Any authenticated employee can check in / out for themselves (self-service).
     * The route middleware (permission:attendance.check_in) gates access to the feature.
     */
    public function checkIn(User $user): bool
    {
        return true;
    }

    /**
     * View the check-in list. The route middleware (permission:attendance.view)
     * gates access; CheckInService role-scopes the actual results (admin=all,
     * manager=team, employee=own), so any authenticated viewer is permitted here.
     */
    public function viewCheckIns(User $user): bool
    {
        return true;
    }

    /**
     * View EVERY employee's check-in records org-wide (not just a managed team).
     * Held by admin/owner and hr_manager via attendance.view_all. The service still
     * scopes results, but this gate decides the "all-org" branch.
     */
    public function viewAll(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'attendance.view_all');
    }

    /**
     * Export a check-in report (CSV). Gated by attendance.export (admin/owner + hr_manager).
     */
    public function export(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'attendance.export');
    }
}
