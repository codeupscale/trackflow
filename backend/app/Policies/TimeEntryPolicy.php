<?php

namespace App\Policies;

use App\Models\TimeEntry;
use App\Models\User;
use App\Services\PermissionService;

class TimeEntryPolicy
{
    public function viewAny(User $user): bool
    {
        return true; // All roles can view (scoped by GlobalOrganizationScope + controller logic)
    }

    public function view(User $user, TimeEntry $entry): bool
    {
        if ($user->organization_id !== $entry->organization_id) {
            return false;
        }

        // Own entry
        if ($user->id === $entry->user_id) {
            return true;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'time_entries.view');

        if ($scope === 'organization') {
            return true;
        }

        if (($scope === 'project')) {
            return in_array($entry->user_id, $service->getProjectUserIds($user));
        }

        return false;
    }

    public function create(User $user): bool
    {
        return true; // All roles can create their own entries
    }

    public function update(User $user, TimeEntry $entry): bool
    {
        if ($user->organization_id !== $entry->organization_id) {
            return false;
        }

        // Own entry
        if ($user->id === $entry->user_id) {
            return app(PermissionService::class)->hasPermission($user, 'time_entries.edit');
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'time_entries.edit');

        if ($scope === 'organization') {
            return true;
        }

        if (($scope === 'project')) {
            return in_array($entry->user_id, $service->getProjectUserIds($user));
        }

        return false;
    }

    public function delete(User $user, TimeEntry $entry): bool
    {
        if ($user->organization_id !== $entry->organization_id) {
            return false;
        }

        // Own entry — only if user has delete permission at own scope
        if ($user->id === $entry->user_id) {
            return app(PermissionService::class)->hasPermission($user, 'time_entries.delete');
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'time_entries.delete');

        if ($scope === 'organization') {
            return true;
        }

        if (($scope === 'project')) {
            return in_array($entry->user_id, $service->getProjectUserIds($user));
        }

        return false;
    }

    /**
     * @param  TimeEntry|string|null  $entry  A TimeEntry for a per-entry check, or the
     *         class-name / null for a class-level "can approve anything" check (used by
     *         the pending-approvals list). The service enforces self-approval prevention.
     */
    public function approve(User $user, TimeEntry|string|null $entry = null): bool
    {
        return $this->canApproveScope($user, $entry);
    }

    /**
     * Rejecting a pending entry uses the same scope as approving it.
     *
     * @param  TimeEntry|string|null  $entry
     */
    public function reject(User $user, TimeEntry|string|null $entry = null): bool
    {
        return $this->canApproveScope($user, $entry);
    }

    /**
     * Shared approve/reject scope resolution.
     */
    private function canApproveScope(User $user, TimeEntry|string|null $entry): bool
    {
        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'time_entries.approve');

        if ($scope === null) {
            return false;
        }

        // Class-level check (pending list): any approve scope is enough. Row-level
        // narrowing happens in ManualTimeEntryService::listPending().
        if (! $entry instanceof TimeEntry) {
            return true;
        }

        if ($user->organization_id !== $entry->organization_id) {
            return false;
        }

        if ($scope === 'organization') {
            return true;
        }

        if ($scope === 'project') {
            return in_array($entry->user_id, $service->getProjectUserIds($user));
        }

        return false;
    }
}
