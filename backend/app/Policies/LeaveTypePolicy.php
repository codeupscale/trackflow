<?php

namespace App\Policies;

use App\Models\User;

class LeaveTypePolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function create(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }
}
