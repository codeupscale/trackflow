<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Second pass of the employee permission-drift repair (see migration
 * 2026_08_25_000003, which covered projects.* and roles.*).
 *
 * Same production symptom, different screens: employees saw the "Add
 * Department" and "Add Position" buttons. Those are gated on
 * `departments.create` / `positions.create`, which PermissionSeeder never
 * grants an employee — so, as before, the rows genuinely exist in that
 * database and the fix is to remove them.
 *
 * A separate migration rather than an edit to 000003 because that one is
 * already pushed and has run; an edited migration would never re-run where it
 * is already recorded.
 *
 * Backend was never exposed: an employee POSTing /hr/departments gets 403
 * (verified). UI-only leak, but the control is inert and confusing.
 *
 * `departments.view` / `positions.view` are deliberately KEPT — employees
 * legitimately need to see the org structure, and the employee seeder grants
 * `departments.view`. Only management verbs are revoked.
 */
return new class extends Migration
{
    private const REVOKE = [
        'departments.create',
        'departments.edit',
        'departments.delete',
        'positions.create',
        'positions.edit',
        'positions.delete',
        'positions.view_salary',
    ];

    public function up(): void
    {
        // Scoped to the `employee` system role across every org; custom roles
        // are left alone in case an org deliberately granted these.
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
        // Deliberately irreversible: these grants were drift, not intent.
    }
};
