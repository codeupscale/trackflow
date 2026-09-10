<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Take shift MANAGEMENT back off the employee role.
 *
 * 2026_08_27_000002 granted shifts.create/edit/delete/manage_assignments to
 * every employee at 'project' scope, on the reasoning that a second gate
 * (actually managing a team) would keep it harmless. That gate exists in the
 * service and the policy, but the SIDEBAR filters on key presence alone — so
 * the moment the keys existed, "Shifts" and "Shift Assignment" appeared in the
 * menu for every employee in the organization.
 *
 * Employees keep shifts.view: they should see their own shift, read-only.
 * Team-scoped management stays implemented and is available to any role an
 * organization chooses to grant it to — it is simply no longer handed to
 * everyone by default.
 */
return new class extends Migration
{
    private const KEYS = [
        'shifts.create',
        'shifts.edit',
        'shifts.delete',
        'shifts.manage_assignments',
    ];

    public function up(): void
    {
        $permissionIds = DB::table('permissions')->whereIn('key', self::KEYS)->pluck('id');
        $roleIds = DB::table('roles')->where('name', 'employee')->pluck('id');

        if ($permissionIds->isEmpty() || $roleIds->isEmpty()) {
            return;
        }

        DB::table('role_permissions')
            ->whereIn('role_id', $roleIds)
            ->whereIn('permission_id', $permissionIds)
            ->delete();
    }

    public function down(): void
    {
        // Deliberately not reinstated: restoring it would put management UI back
        // in front of every employee, which is the bug this removes.
    }
};
