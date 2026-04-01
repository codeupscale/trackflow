<?php

namespace App\Policies;

use App\Models\EmployeeDocument;
use App\Models\User;

class EmployeeDocumentPolicy
{
    /**
     * Same org AND (self OR admin/owner/manager) can list documents.
     */
    public function viewAny(User $user, string $employeeId): bool
    {
        return $user->id === $employeeId || $user->hasRole('owner', 'admin', 'manager');
    }

    /**
     * Same org AND (self OR admin/owner) can upload documents.
     */
    public function create(User $user, string $employeeId): bool
    {
        return $user->id === $employeeId || $user->hasRole('owner', 'admin');
    }

    /**
     * Admin/owner only can delete.
     */
    public function delete(User $user, EmployeeDocument $document): bool
    {
        if ($user->organization_id !== $document->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }

    /**
     * Admin/owner only can verify.
     */
    public function verify(User $user, EmployeeDocument $document): bool
    {
        if ($user->organization_id !== $document->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin');
    }
}
