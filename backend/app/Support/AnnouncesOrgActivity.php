<?php

namespace App\Support;

use App\Models\User;
use App\Notifications\OrgActivity;
use App\Notifications\TrackflowNotification;
use App\Services\NotificationRecipients;
use Illuminate\Support\Facades\Notification;

/**
 * Send one organisation-activity notification, safely.
 *
 * Every call site needs the same four things — resolve the audience, skip when
 * it is empty, exclude the actor, and never let a failure reach the caller —
 * and repeating that around nine triggers is nine chances to forget the
 * try/catch. Forgetting it is not cosmetic: an uncaught failure here would fail
 * the ACTION, so a dead queue would stop people approving leave or running
 * payroll.
 *
 * Always call this AFTER the transaction commits. A queue worker is fast enough
 * to pick the job up before an open transaction lands, and it would then read
 * rows that do not exist yet.
 */
trait AnnouncesOrgActivity
{
    protected function announceToOrg(
        string $organizationId,
        ?string $exceptUserId,
        TrackflowNotification $notification,
    ): void {
        try {
            $watchers = app(NotificationRecipients::class)
                ->orgActivityWatchers($organizationId, $exceptUserId);

            if ($watchers->isEmpty()) {
                return;
            }

            Notification::send($watchers, $notification);
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * Someone joined an organization that already existed.
     *
     * One method because a person can arrive three ways — accepting an email
     * invitation, signing up with Google (which auto-accepts any pending
     * invitation), or SAML single sign-on provisioning them on first login —
     * and when this lived inline in the invitation controller alone, the other
     * two added people to the org with nobody told.
     *
     * NOT for someone creating their own organization: they are its only
     * member, so the audience would be empty anyway, and "you joined the org
     * you just created" is not news.
     */
    protected function announceJoiner(User $user): void
    {
        $this->announceToOrg(
            $user->organization_id,
            $user->id,
            OrgActivity::employeeAdded(
                name: $user->name,
                email: $user->email,
                role: $user->role,
                userId: $user->id,
            ),
        );
    }
}
