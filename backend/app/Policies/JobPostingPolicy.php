<?php

namespace App\Policies;

use App\Models\JobPosting;
use App\Models\User;
use App\Services\PermissionService;

class JobPostingPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, JobPosting $posting): bool
    {
        return $user->organization_id === $posting->organization_id;
    }

    public function create(User $user): bool
    {
        return app(PermissionService::class)->hasPermission($user, 'job_postings.create');
    }

    public function update(User $user, JobPosting $posting): bool
    {
        if ($user->organization_id !== $posting->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'job_postings.edit');
    }

    public function delete(User $user, JobPosting $posting): bool
    {
        if ($user->organization_id !== $posting->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'job_postings.delete');
    }

    /**
     * Publishing is what puts a posting in front of the public, so it is gated
     * separately from ordinary editing.
     */
    public function publish(User $user, JobPosting $posting): bool
    {
        if ($user->organization_id !== $posting->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'job_postings.publish');
    }

    /**
     * Seeing the salary band on a posting, mirroring positions.view_salary.
     */
    public function viewSalary(User $user, JobPosting $posting): bool
    {
        if ($user->organization_id !== $posting->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'job_postings.view_salary');
    }
}
