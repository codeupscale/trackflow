<?php

namespace App\Policies;

use App\Models\AttendanceRegularization;
use App\Models\User;

class AttendanceRegularizationPolicy
{
    /**
     * Manager/admin/owner can approve regularization requests (not their own).
     */
    public function approve(User $user, AttendanceRegularization $reg): bool
    {
        if ($user->organization_id !== $reg->organization_id) {
            return false;
        }

        // Cannot approve own regularization
        if ($user->id === $reg->user_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager');
    }
}
