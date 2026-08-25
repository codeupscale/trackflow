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
     * Own request, OR has project/org scope for leave.view_requests.
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

        if (($scope === 'project')) {
            return in_array($leaveRequest->user_id, $service->getProjectUserIds($user));
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
     * ONLY the requester may edit their own leave request. Approvers — HR,
     * admin, manager, even the owner — can VIEW everyone's requests but never
     * edit someone else's: changing another person's dates or reason would
     * falsify what they actually asked for. Approvers act via approve/reject.
     * (The pending-only restriction lives in the controller as a 422.)
     */
    public function update(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        return $user->id === $leaveRequest->user_id;
    }

    /**
     * Users with leave.approve can approve/reject, but NOT their own request —
     * self-approval would bypass oversight. The ONE exception is the owner:
     * there is nobody above them in the org to decide their leave, so blocking
     * them would strand their requests in pending forever. Every other approver
     * (org_manager, hr_manager, project manager) must have someone else act:
     * an admin/manager's request goes to HR or the owner, HR's to the owner.
     */
    public function approve(User $user, LeaveRequest $leaveRequest): bool
    {
        if ($user->organization_id !== $leaveRequest->organization_id) {
            return false;
        }

        // Prevent self-approval for everyone except the owner
        if ($user->id === $leaveRequest->user_id && ! $user->hasRole('owner')) {
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

        if (($scope === 'project')) {
            return in_array($leaveRequest->user_id, $service->getProjectUserIds($user));
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
