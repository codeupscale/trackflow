<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Consolidate 4 system roles into 5:
 *   owner       (100) — unchanged
 *   org_manager  (75) — renamed from 'admin'
 *   hr_manager   (65) — new
 *   finance_manager (60) — new
 *   employee     (10) — display_name updated to 'Employee / Member'
 *
 * All 'manager' users and 'admin' users are migrated to 'org_manager'.
 * The 'manager' system role is deleted (role_permissions + user_roles migrated first).
 * HR Manager and Finance Manager roles are NOT created here — PermissionSeeder handles
 * role creation + role_permissions for all orgs via seedRolesForOrg().
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::transaction(function () {
            $now = now();

            // ── Step 1: Rename 'admin' → 'org_manager' in all orgs ─────────────
            DB::table('roles')
                ->where('name', 'admin')
                ->where('is_system', true)
                ->update([
                    'name'         => 'org_manager',
                    'display_name' => 'Organization Manager',
                    'updated_at'   => $now,
                ]);

            // ── Step 2: Migrate users.role column ──────────────────────────────
            DB::table('users')->where('role', 'admin')->update(['role' => 'org_manager']);
            DB::table('users')->where('role', 'manager')->update(['role' => 'org_manager']);

            // ── Step 3: Migrate manager user_roles → org_manager ───────────────
            // Build org → org_manager role_id map
            $orgManagerMap = DB::table('roles')
                ->where('name', 'org_manager')
                ->where('is_system', true)
                ->select('id', 'organization_id')
                ->get()
                ->keyBy('organization_id');

            $managerRoles = DB::table('roles')
                ->where('name', 'manager')
                ->where('is_system', true)
                ->select('id', 'organization_id')
                ->get();

            foreach ($managerRoles as $managerRole) {
                $orgManager = $orgManagerMap[$managerRole->organization_id] ?? null;

                if ($orgManager) {
                    // Users already in org_manager don't get duplicated
                    $alreadyAssigned = DB::table('user_roles')
                        ->where('role_id', $orgManager->id)
                        ->pluck('user_id')
                        ->toArray();

                    DB::table('user_roles')
                        ->where('role_id', $managerRole->id)
                        ->whereNotIn('user_id', $alreadyAssigned)
                        ->update(['role_id' => $orgManager->id]);
                }

                // Remove any remaining user_roles for this manager role (duplicates)
                DB::table('user_roles')->where('role_id', $managerRole->id)->delete();

                // Remove role_permissions for manager role
                DB::table('role_permissions')->where('role_id', $managerRole->id)->delete();

                // Delete the manager role itself
                DB::table('roles')->where('id', $managerRole->id)->delete();
            }

            // ── Step 4: Update employee display_name ───────────────────────────
            DB::table('roles')
                ->where('name', 'employee')
                ->where('is_system', true)
                ->update([
                    'display_name' => 'Employee / Member',
                    'updated_at'   => $now,
                ]);

            // ── Step 5: Update invitations — map old role values ───────────────
            DB::table('invitations')->where('role', 'admin')->update(['role' => 'org_manager']);
            DB::table('invitations')->where('role', 'manager')->update(['role' => 'org_manager']);
        });
    }

    public function down(): void
    {
        // Reverting this migration is not supported — role renames cannot be
        // safely reversed once users have been re-assigned.
    }
};
