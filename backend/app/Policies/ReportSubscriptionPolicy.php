<?php

namespace App\Policies;

use App\Models\ReportSubscription;
use App\Models\User;

class ReportSubscriptionPolicy
{
    /**
     * Any authenticated user can list their own subscriptions.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Any authenticated user can create report subscriptions for themselves.
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * A user can only delete their own subscription.
     */
    public function delete(User $user, ReportSubscription $subscription): bool
    {
        return $user->id === $subscription->user_id;
    }
}
