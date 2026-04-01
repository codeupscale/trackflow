<?php

namespace App\Policies;

use App\Models\Project;
use App\Models\User;
use App\Services\PermissionService;

class ProjectPolicy
{
    public function viewAny(User $user): bool
    {
        return true; // Listing is scoped in controller by role (employees see assigned only).
    }

    public function view(User $user, Project $project): bool
    {
        if ($user->organization_id !== $project->organization_id) {
            return false;
        }

        // If user has org-wide view, allow
        $scope = app(PermissionService::class)->getScope($user, 'projects.view');
        if ($scope === 'organization') {
            return true;
        }

        // Otherwise, must be assigned to the project
        return $project->isAssignedTo($user);
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'projects.create');
    }

    public function update(User $user, Project $project): bool
    {
        if ($user->organization_id !== $project->organization_id) {
            return false;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'projects.edit');

        if ($scope === 'organization') {
            return true;
        }

        // Own scope: user is the project manager
        if ($scope === 'own' && $project->manager_id === $user->id) {
            return true;
        }

        return false;
    }

    public function delete(User $user, Project $project): bool
    {
        if ($user->organization_id !== $project->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'projects.delete');
    }
}
