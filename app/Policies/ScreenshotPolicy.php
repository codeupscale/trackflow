<?php

namespace App\Policies;

use App\Models\Screenshot;
use App\Models\User;

class ScreenshotPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, Screenshot $screenshot): bool
    {
        if ($user->organization_id !== $screenshot->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager') || $user->id === $screenshot->user_id;
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function delete(User $user, Screenshot $screenshot): bool
    {
        if ($user->organization_id !== $screenshot->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }
}
