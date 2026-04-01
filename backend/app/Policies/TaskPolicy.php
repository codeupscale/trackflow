<?php

namespace App\Policies;

use App\Models\Task;
use App\Models\User;
use App\Services\PermissionService;

class TaskPolicy
{
    public function viewAny(User $user): bool
    {
        return true; // All roles can view (scoped by controller and organization)
    }

    public function view(User $user, Task $task): bool
    {
        return $user->organization_id === $task->organization_id;
    }

    public function create(User $user): bool
    {
        return true; // All roles can create tasks
    }

    public function update(User $user, Task $task): bool
    {
        if ($user->organization_id !== $task->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'projects.edit');
    }

    public function delete(User $user, Task $task): bool
    {
        if ($user->organization_id !== $task->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'projects.edit');
    }
}
