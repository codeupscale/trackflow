<?php

namespace App\Notifications;

use App\Notifications\Channels\SafeBroadcastChannel;
use App\Support\NotificationPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\BroadcastMessage;
use Illuminate\Notifications\Notification;

/**
 * The shape every TrackFlow notification shares.
 *
 * One class per event, but one PAYLOAD for all of them — the bell renders a
 * list of mixed types and cannot branch per class, so title/body/url/category
 * are fixed here and each subclass only fills them in. Anything type-specific
 * rides in `meta`, which the UI may use and may equally ignore.
 *
 * Queued by contract. A notification is a side effect of an action the user is
 * waiting on — a check-in, a payslip being sent — and must never be able to
 * slow that action down or fail it. Horizon runs them.
 *
 * Delivery is database + broadcast: the row is the source of truth that
 * survives a refresh, and the broadcast is only a nudge that makes the bell
 * update without one. Mail is added per-subclass, never by default.
 */
abstract class TrackflowNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public $tries = 3;

    public $backoff = [10, 60, 300];

    /** Short machine-readable kind, e.g. 'attendance.checked_in'. */
    abstract public function category(): string;

    /** One line, the notification's subject. */
    abstract public function title(object $notifiable): string;

    /** One or two lines of detail. */
    abstract public function body(object $notifiable): string;

    /** Where clicking it should go, relative to the web app root. */
    abstract public function url(object $notifiable): string;

    /** Type-specific extras. Never required by the renderer. */
    public function meta(object $notifiable): array
    {
        return [];
    }

    public function via(object $notifiable): array
    {
        return $this->respectingPreferences($notifiable, ['database', SafeBroadcastChannel::class]);
    }

    /**
     * Drop the in-app channels for a group the person has muted.
     *
     * Applied at DELIVERY, per recipient, rather than when choosing who to send
     * to. Filtering the recipient list would need every one of the triggers to
     * remember to do it; this is the one place every notification passes
     * through, so a trigger added next year respects mutes without knowing they
     * exist.
     *
     * Mail is kept deliberately — see NotificationPreferences.
     */
    protected function respectingPreferences(object $notifiable, array $channels): array
    {
        if (! NotificationPreferences::isMuted($notifiable, $this->category())) {
            return $channels;
        }

        return array_values(array_filter($channels, fn ($c) => $c === 'mail'));
    }

    public function toArray(object $notifiable): array
    {
        return [
            'category' => $this->category(),
            'title' => $this->title($notifiable),
            'body' => $this->body($notifiable),
            'url' => $this->url($notifiable),
            'meta' => $this->meta($notifiable),
        ];
    }

    /**
     * Sent over the private App.Models.User.{id} channel Laravel uses for
     * notifications, which routes/channels.php already authorizes.
     *
     * The payload is deliberately the same as the stored row. The client treats
     * a broadcast as "something arrived, here it is" and can render it without
     * a round trip, while still reconciling against the API on next fetch.
     */
    public function toBroadcast(object $notifiable): BroadcastMessage
    {
        return new BroadcastMessage([
            'id' => $this->id,
            'category' => $this->category(),
            'title' => $this->title($notifiable),
            'body' => $this->body($notifiable),
            'url' => $this->url($notifiable),
            'meta' => $this->meta($notifiable),
            'read_at' => null,
            'created_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * Store the category as the row's `type` instead of the PHP class name.
     *
     * The class name is an implementation detail that leaks into the API and
     * breaks every stored row the day a class is renamed or moved. A category
     * is a contract the frontend can switch on safely.
     */
    public function databaseType(object $notifiable): string
    {
        return $this->category();
    }
}
