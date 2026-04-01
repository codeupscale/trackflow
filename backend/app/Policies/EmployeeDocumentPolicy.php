<?php

namespace App\Policies;

use App\Models\EmployeeDocument;
use App\Models\User;
use App\Services\PermissionService;

class EmployeeDocumentPolicy
{
    /**
     * Same org AND (self OR has employees.manage_documents permission).
     */
    public function viewAny(User $user, string $employeeId): bool
    {
        if ($user->id === $employeeId) {
            return true;
        }

        return app(PermissionService::class)->hasPermission($user, 'employees.manage_documents');
    }

    /**
     * Same org AND (self OR has employees.manage_documents at org scope).
     */
    public function create(User $user, string $employeeId): bool
    {
        if ($user->id === $employeeId) {
            return true;
        }

        return app(PermissionService::class)->hasPermission($user, 'employees.manage_documents', 'organization');
    }

    /**
     * Must have employees.manage_documents at org scope to delete.
     */
    public function delete(User $user, EmployeeDocument $document): bool
    {
        if ($user->organization_id !== $document->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'employees.manage_documents', 'organization');
    }

    /**
     * Must have employees.manage_documents at org scope to verify.
     */
    public function verify(User $user, EmployeeDocument $document): bool
    {
        if ($user->organization_id !== $document->organization_id) {
            return false;
        }

        return app(PermissionService::class)->hasPermission($user, 'employees.manage_documents', 'organization');
    }
}
