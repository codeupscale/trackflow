<?php

namespace App\Policies;

use App\Models\Position;
use App\Models\User;

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
        return $user->hasRole('owner', 'admin', 'manager');
    }

    public function update(User $user, Position $position): bool
    {
        if ($user->organization_id !== $position->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager');
    }

    public function delete(User $user, Position $position): bool
    {
        if ($user->organization_id !== $position->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }
}
