<?php

namespace App\Policies;

use App\Models\User;
use App\Services\PermissionService;

class UserPolicy
{
    public function viewAny(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'team.view_members');
    }

    public function view(User $user, User $target): bool
    {
        if ($user->organization_id !== $target->organization_id) {
            return false;
        }

        // Users can always view themselves
        if ($user->id === $target->id) {
            return true;
        }

        return app(PermissionService::class)->hasPermission($user, 'team.view_members');
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'team.invite');
    }

    public function update(User $user, User $target): bool
    {
        if ($user->organization_id !== $target->organization_id) {
            return false;
        }

        // Users can always update themselves (profile)
        if ($user->id === $target->id) {
            return true;
        }

        return app(PermissionService::class)->hasPermission($user, 'team.change_role');
    }

    public function delete(User $user, User $target): bool
    {
        if ($user->organization_id !== $target->organization_id) {
            return false;
        }

        // Cannot delete yourself
        if ($user->id === $target->id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'team.remove');
    }

    public function manageRoles(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'roles.edit');
    }
}
