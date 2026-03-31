<?php

namespace App\Policies;

use App\Models\PublicHoliday;
use App\Models\User;

class PublicHolidayPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, PublicHoliday $publicHoliday): bool
    {
        return $user->organization_id === $publicHoliday->organization_id;
    }

    /**
     * Only owner/admin can create public holidays for the org.
     */
    public function create(User $user): bool
    {
        return $user->hasRole('owner', 'admin');
    }

    public function update(User $user, PublicHoliday $publicHoliday): bool
    {
        return $user->organization_id === $publicHoliday->organization_id
            && $user->hasRole('owner', 'admin');
    }

    public function delete(User $user, PublicHoliday $publicHoliday): bool
    {
        return $user->organization_id === $publicHoliday->organization_id
            && $user->hasRole('owner', 'admin');
    }
}
