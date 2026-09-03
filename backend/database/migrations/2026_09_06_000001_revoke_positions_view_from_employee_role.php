<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Third pass of the employee permission-drift repair (after 2026_08_25_000003
 * for projects/roles and 000004 for the department/position management verbs).
 *
 * Reported from production: employees see the "Positions" item in the sidebar.
 * They do not see it on a freshly seeded database, because PermissionSeeder's
 * employee block grants `departments.view` and deliberately NOT
 * `positions.view` — its own comment reads "employees can view the org tree
 * (not positions)". So the rows exist in that database and the seeder never put
 * them there: drift, same as the two earlier passes.
 *
 * Why 000004 left it behind: that migration kept `positions.view` on the stated
 * reasoning that "the employee seeder grants departments.view" — true of
 * departments, not of positions. The two environments have been out of sync on
 * this single key ever since. This closes it.
 *
 * Positions is an HR configuration screen; the salary bands on it are already
 * gated separately by `positions.view_salary`, which 000004 revoked. Nothing an
 * employee needs reads this key: the position field on the employee profile
 * sheet sits inside the organization-scoped `employees.edit_profile` section,
 * so an own-scope employee never renders it (verified).
 *
 * Custom roles are untouched — an org may have deliberately granted this.
 */
return new class extends Migration
{
    private const REVOKE = [
        'positions.view',
    ];

    public function up(): void
    {
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
        // Deliberately irreversible: this grant was drift, not intent. The
        // seeder has never produced it, so a rollback would recreate a state no
        // fresh install has ever had.
    }
};
