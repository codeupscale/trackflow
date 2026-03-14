<?php

namespace App\Policies;

use App\Models\User;

class UserPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasRole('owner', 'admin', 'manager');
    }

    public function view(User $user, User $target): bool
    {
        if ($user->organization_id !== $target->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager') || $user->id === $target->id;
    }

    public function create(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }

    public function update(User $user, User $target): bool
    {
        if ($user->organization_id !== $target->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin') || $user->id === $target->id;
    }

    public function delete(User $user, User $target): bool
    {
        if ($user->organization_id !== $target->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin') && $user->id !== $target->id;
    }

    public function manageRoles(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }
}
