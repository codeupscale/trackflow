<?php

namespace App\Models;

use Illuminate\Notifications\DatabaseNotification as BaseDatabaseNotification;

/**
 * Laravel's notification row, stamped with the organization.
 *
 * The framework's DatabaseChannel writes only the columns it knows about, so a
 * NOT NULL organization_id has to be filled here — on the way in, from the user
 * the notification is addressed to. Doing it in the model rather than in each
 * notification class means no future notification can forget it.
 *
 * Deliberately NOT covered by GlobalOrganizationScope: notifications are read
 * through `$user->notifications()`, which is already narrowed to one user, and
 * that user is already scoped. A global scope here would need an authenticated
 * org context, and this model is written from the QUEUE, where there is none.
 */
class DatabaseNotification extends BaseDatabaseNotification
{
    protected static function booted(): void
    {
        static::creating(function (self $notification) {
            if (! empty($notification->organization_id)) {
                return;
            }

            $notifiable = $notification->notifiable;

            if ($notifiable && isset($notifiable->organization_id)) {
                $notification->organization_id = $notifiable->organization_id;
            }
        });
    }
}
