<?php

namespace App\Policies;

use App\Models\Shift;
use App\Models\User;
use App\Services\PermissionService;
use App\Services\ShiftService;

/**
 * Shift authorization is PERMISSION-driven, not role-name driven.
 *
 * A role granted a shifts.* permission at 'organization' scope manages every
 * shift (owner / org_manager / hr_manager). A role granted it at 'project'
 * scope is a TEAM manager: they may create shifts and edit/delete only the ones
 * they created. Row-level audience limits (which employees they may assign) live
 * in ShiftService, which the controllers call with the acting user.
 *
 * Hardcoding role names here previously made team-scoped management impossible —
 * and would silently exclude any custom role an org defines.
 */
class ShiftPolicy
{
    /**
     * Any authenticated org member can view shifts.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Any member of the same org can view a shift.
     */
    public function view(User $user, Shift $shift): bool
    {
        return $user->organization_id === $shift->organization_id;
    }

    /**
     * Create requires shifts.create at any scope. A team-scoped creator must
     * also actually manage a team — otherwise the permission grants nothing.
     */
    public function create(User $user): bool
    {
        $permissions = app(PermissionService::class);

        if (! $permissions->hasPermission($user, 'shifts.create')) {
            return false;
        }

        if ($permissions->hasPermission($user, 'shifts.create', 'organization')) {
            return true;
        }

        return $user->managedTeams()->exists();
    }

    /**
     * Org scope → any shift. Team scope → only shifts this user created.
     */
    public function update(User $user, Shift $shift): bool
    {
        return $this->modify($user, $shift, 'shifts.edit');
    }

    public function delete(User $user, Shift $shift): bool
    {
        return $this->modify($user, $shift, 'shifts.delete');
    }

    /**
     * Manage assignments on this shift. A team manager may place their own
     * people onto ANY shift (including HR-defined ones) — the restriction is on
     * WHO they assign, enforced per-user in ShiftService::assertCanAssignUser.
     */
    public function manage(User $user, Shift $shift): bool
    {
        if ($user->organization_id !== $shift->organization_id) {
            return false;
        }

        $permissions = app(PermissionService::class);

        if (! $permissions->hasPermission($user, 'shifts.manage_assignments')) {
            return false;
        }

        if ($permissions->hasPermission($user, 'shifts.manage_assignments', 'organization')) {
            return true;
        }

        return $user->managedTeams()->exists();
    }

    private function modify(User $user, Shift $shift, string $permissionKey): bool
    {
        if ($user->organization_id !== $shift->organization_id) {
            return false;
        }

        return app(ShiftService::class)->canModifyShift($user, $shift, $permissionKey);
    }
}
