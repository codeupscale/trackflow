<?php

namespace App\Policies;

use App\Models\TimeEntry;
use App\Models\User;

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

        return $user->hasRole('owner', 'admin', 'manager') || $user->id === $entry->user_id;
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

        return $user->hasRole('owner', 'admin', 'manager') || $user->id === $entry->user_id;
    }

    public function delete(User $user, TimeEntry $entry): bool
    {
        if ($user->organization_id !== $entry->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager') || $user->id === $entry->user_id;
    }

    public function approve(User $user, TimeEntry $entry): bool
    {
        if ($user->organization_id !== $entry->organization_id) {
            return false;
        }

        return $user->hasRole('owner', 'admin', 'manager');
    }
}
