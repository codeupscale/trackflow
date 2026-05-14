<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Remove role_permissions rows where a has_scope=true permission was
     * incorrectly stored with scope='none'. This happened when the role
     * creation flow seeded all permissions (including scoped ones) with 'none'.
     *
     * For has_scope=true permissions, 'none' is not a valid scope.
     * The correct representation of "no access" is the absence of a row.
     */
    public function up(): void
    {
        // Get all permission IDs where has_scope = true
        $scopedPermissionIds = DB::table('permissions')
            ->where('has_scope', true)
            ->pluck('id');

        if ($scopedPermissionIds->isEmpty()) {
            return;
        }

        // Delete any role_permissions rows that have scope='none' for scoped permissions.
        // These are invalid data created by the old handleCreate bug in the frontend.
        DB::table('role_permissions')
            ->whereIn('permission_id', $scopedPermissionIds)
            ->where('scope', 'none')
            ->delete();
    }

    public function down(): void
    {
        // Cannot restore deleted rows without knowing the original intent.
        // This migration is a data cleanup only.
    }
};
