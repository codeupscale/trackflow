<?php

namespace App\Policies;

use App\Models\Position;
use App\Models\User;
use App\Services\PermissionService;

class PositionPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Position $position): bool
    {
        return $user->organization_id === $position->organization_id;
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'positions.create');
    }

    public function update(User $user, Position $position): bool
    {
        if ($user->organization_id !== $position->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'positions.edit');
    }

    public function delete(User $user, Position $position): bool
    {
        if ($user->organization_id !== $position->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'positions.delete');
    }
}
