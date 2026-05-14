<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // 1. Mark the permission itself as scoped
        DB::table('permissions')
            ->where('key', 'employees.view_directory')
            ->update(['has_scope' => true]);

        // 2. Fix the scope value in role_permissions based on system role name.
        //    permissions table is global (no organization_id column) — get the single permission ID.
        $permissionId = DB::table('permissions')
            ->where('key', 'employees.view_directory')
            ->value('id');

        if (! $permissionId) {
            return;
        }

        // Map role name → correct scope
        $scopeMap = [
            'employee' => 'own',
            'manager'  => 'project',
            'admin'    => 'organization',
            'owner'    => 'organization',
        ];

        foreach ($scopeMap as $roleName => $scope) {
            // Get all system role IDs with this name (across all orgs)
            $roleIds = DB::table('roles')
                ->where('name', $roleName)
                ->where('is_system', true)
                ->pluck('id');

            foreach ($roleIds as $roleId) {
                DB::table('role_permissions')
                    ->where('role_id', $roleId)
                    ->where('permission_id', $permissionId)
                    ->where('scope', 'none')
                    ->update(['scope' => $scope]);
            }
        }
    }

    public function down(): void
    {
        // Revert: mark permission as non-scoped and reset all scopes to 'none'
        DB::table('permissions')
            ->where('key', 'employees.view_directory')
            ->update(['has_scope' => false]);

        $permissionId = DB::table('permissions')
            ->where('key', 'employees.view_directory')
            ->value('id');

        if (! $permissionId) {
            return;
        }

        DB::table('role_permissions')
            ->where('permission_id', $permissionId)
            ->whereIn('scope', ['own', 'project', 'organization'])
            ->update(['scope' => 'none']);
    }
};
