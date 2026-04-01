<?php

namespace App\Policies;

use App\Models\EmployeeNote;
use App\Models\User;
use App\Services\PermissionService;

class EmployeeNotePolicy
{
    public function viewAny(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'employees.manage_notes');
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'employees.manage_notes');
    }

    public function delete(User $user, EmployeeNote $note): bool
    {
        if ($user->organization_id !== $note->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'employees.manage_notes');
    }
}
