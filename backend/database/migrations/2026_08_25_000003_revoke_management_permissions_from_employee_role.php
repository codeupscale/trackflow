<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Repair employee roles that drifted from PermissionSeeder.
 *
 * Reported from production: employees saw the "Add Project" button and the
 * Roles item in the sidebar. Both are gated on permission KEYS
 * (`projects.create`, `roles.view`), and the frontend's hasPermission() is a
 * key-presence check — absence is the only "deny", there is no deny value. So
 * the buttons appearing means those rows genuinely exist in role_permissions
 * for the employee role in that database, which the seeder never grants.
 *
 * The backend was never exposed: ProjectController::store() authorises through
 * ProjectPolicy::create(), and an employee POSTing /projects gets 403. This is
 * a UI leak only — but a confusing one, since the control does nothing.
 *
 * Re-running PermissionSeeder would fix it and is NOT safe here: it deletes and
 * recreates each org's system roles, and user_roles.role_id is ON DELETE
 * CASCADE, so every role assignment in the org would be silently dropped. This
 * migration therefore removes only the specific offending grants.
 */
return new class extends Migration
{
    /** Permissions no employee should ever hold. */
    private const REVOKE = [
        'projects.create',
        'projects.edit',
        'projects.delete',
        'projects.manage_members',
        'roles.view',
        'roles.create',
        'roles.edit',
        'roles.delete',
        'roles.assign',
    ];

    public function up(): void
    {
        // Scoped to the `employee` system role across every org. Custom roles
        // are left alone: an org may deliberately have defined one that grants
        // project management, and this migration must not silently undo that.
        $employeeRoleIds = DB::table('roles')->where('name', 'employee')->pluck('id');

        if ($employeeRoleIds->isEmpty()) {
            return;
        }

        $permissionIds = DB::table('permissions')
            ->whereIn('key', self::REVOKE)
            ->pluck('id');

        if ($permissionIds->isEmpty()) {
            return;
        }

        DB::table('role_permissions')
            ->whereIn('role_id', $employeeRoleIds)
            ->whereIn('permission_id', $permissionIds)
            ->delete();
    }

    public function down(): void
    {
        // Deliberately irreversible: these grants were drift, not intent, and
        // re-adding them would recreate the leak. Roles are re-derivable from
        // PermissionSeeder if a genuine rollback is ever needed.
    }
};
