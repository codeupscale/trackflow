<?php

namespace App\Services;

use App\Models\User;
use Database\Seeders\PermissionSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Handles RBAC bootstrapping for newly created organizations and users.
 *
 * Called from AuthController (register, Google OAuth) and InvitationController (accept)
 * to ensure every org has system roles seeded and every user has a user_roles row.
 */
class RbacBootstrapService
{
    /**
     * Seed the four system roles (owner, admin, manager, employee) and their
     * default permission assignments for a newly created organization.
     *
     * Idempotent: skips silently if system roles already exist for this org.
     */
    public function bootstrapOrg(string $orgId): void
    {
        $existing = DB::table('roles')
            ->where('organization_id', $orgId)
            ->where('is_system', true)
            ->count();

        if ($existing > 0) {
            return; // Already seeded
        }

        $seeder = new PermissionSeeder();
        $seeder->seedRolesForOrg($orgId);
    }

    /**
     * Assign a user to the system role matching $roleName within their organization.
     *
     * Idempotent: skips silently if the user already has a user_roles row.
     * Falls back to 'employee' if the role name is not found.
     *
     * Must be called INSIDE an existing DB transaction (uses the same connection).
     */
    public function assignUserToRole(User $user, string $roleName): void
    {
        // Already assigned — skip
        $alreadyAssigned = DB::table('user_roles')
            ->where('user_id', $user->id)
            ->exists();

        if ($alreadyAssigned) {
            return;
        }

        $role = DB::table('roles')
            ->where('organization_id', $user->organization_id)
            ->where('name', $roleName)
            ->first();

        // Fallback to employee if the requested role doesn't exist
        if (! $role) {
            $role = DB::table('roles')
                ->where('organization_id', $user->organization_id)
                ->where('name', 'employee')
                ->first();
        }

        if (! $role) {
            return; // Nothing to assign — bootstrapOrg wasn't called first
        }

        DB::table('user_roles')->insert([
            'id'          => Str::uuid()->toString(),
            'user_id'     => $user->id,
            'role_id'     => $role->id,
            'assigned_by' => null,
            'assigned_at' => now(),
        ]);
    }

    /**
     * Full bootstrap: seed org roles then assign the user.
     * Convenience wrapper — both calls share the same transaction context.
     */
    public function bootstrapOrgAndAssignUser(User $user, string $roleName): void
    {
        $this->bootstrapOrg($user->organization_id);
        $this->assignUserToRole($user, $roleName);
    }
}
