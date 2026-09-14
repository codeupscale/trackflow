<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Take Job Postings away from finance_manager (owner decision, 2026-09-10).
 *
 * Finance held `job_postings.view` and `job_postings.view_salary` so they could
 * read the compensation attached to an open role. The owner's call is that
 * recruitment belongs to HR and the item was only crowding the finance
 * sidebar. `view_salary` goes with it: it is consulted while rendering a
 * posting, so on its own it grants nothing at all.
 *
 * A migration rather than a seeder run, for the usual reason — PermissionSeeder
 * DELETES and recreates each org's system roles, and `user_roles.role_id` is
 * ON DELETE CASCADE, so running it against a live database silently drops every
 * role assignment in the org.
 *
 * Custom roles are untouched: an org that deliberately granted this to its own
 * role keeps it.
 */
return new class extends Migration
{
    private const REVOKE = [
        'job_postings.view',
        'job_postings.view_salary',
    ];

    public function up(): void
    {
        $financeRoleIds = DB::table('roles')
            ->where('name', 'finance_manager')
            ->where('is_system', true)
            ->pluck('id');

        if ($financeRoleIds->isEmpty()) {
            return;
        }

        $permissionIds = DB::table('permissions')
            ->whereIn('key', self::REVOKE)
            ->pluck('id');

        if ($permissionIds->isEmpty()) {
            return;
        }

        DB::table('role_permissions')
            ->whereIn('role_id', $financeRoleIds)
            ->whereIn('permission_id', $permissionIds)
            ->delete();
    }

    public function down(): void
    {
        // Deliberately irreversible: the grant was withdrawn on purpose, and a
        // rollback would hand a role back an item the owner asked to remove.
    }
};
