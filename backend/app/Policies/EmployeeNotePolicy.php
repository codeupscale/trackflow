<?php

namespace App\Policies;

use App\Models\EmployeeNote;
use App\Models\User;

class EmployeeNotePolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }

    public function create(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }

    public function delete(User $user, EmployeeNote $note): bool
    {
        return $user->organization_id === $note->organization_id
            && $user->hasRole('owner', 'admin');
    }
}
