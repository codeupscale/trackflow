<?php

namespace App\Policies;

use App\Models\LeaveRequest;
use App\Models\User;
use App\Services\PermissionService;

class LeaveRequestPolicy
{
    /**
     * Any authenticated org member can view the list (scoping is done in controller).
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Own request, OR has team/org scope for leave.view_requests.
     */
    public function view(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        // Own request
        if ($user->id === $leaveRequest->user_id) {
            return true;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'leave.view_requests');

        if ($scope === 'organization') {
            return true;
        }

        if ($scope === 'team') {
            return in_array($leaveRequest->user_id, $service->getTeamUserIds($user));
        }

        return false;
    }

    /**
     * Any authenticated org member can create a leave request.
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * Only users with leave.approve at org scope can edit a submitted request.
     */
    public function update(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'leave.approve', 'organization');
    }

    /**
     * Users with leave.approve can approve, but NOT their own request.
     * Self-approval would bypass oversight.
     */
    public function approve(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        // Prevent self-approval
        if ($user->id === $leaveRequest->user_id) {
            return false;
        }

        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'leave.approve');

        if ($scope === null) {
            return false;
        }

        if ($scope === 'organization') {
            return true;
        }

        if ($scope === 'team') {
            return in_array($leaveRequest->user_id, $service->getTeamUserIds($user));
        }

        return false;
    }

    /**
     * Own request with status pending/approved, OR users with leave.cancel at org scope.
     */
    public function delete(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        $validStatuses = ['pending', 'approved'];

        // Users with org-wide cancel can cancel any request in valid status
        $service = app(PermissionService::class);
        $scope = $service->getScope($user, 'leave.cancel');

        if ($scope === 'organization' && in_array($leaveRequest->status, $validStatuses)) {
            return true;
        }

        // Own request, only if pending or approved
        return $user->id === $leaveRequest->user_id
            && in_array($leaveRequest->status, $validStatuses);
    }
}
