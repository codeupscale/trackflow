<?php

namespace App\Notifications\Channels;

use Illuminate\Notifications\Channels\BroadcastChannel;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\Log;

/**
 * Laravel's broadcast channel, made non-fatal.
 *
 * A notification is delivered by two channels, in order: the database row,
 * which is the source of truth, then a websocket push, which only makes the bell
 * update without waiting for its poll. With the stock channel a Reverb outage
 * throws inside the queued job, so the row is written and then the job FAILS —
 * every notification during an outage lands in failed_jobs, retries, and buries
 * the genuine failures an on-call engineer needs to see.
 *
 * Losing the push costs the user at most one poll interval: the row is already
 * there and the bell picks it up within a minute. That is not worth failing a
 * job over, so the failure is logged once per notification and swallowed.
 *
 * Deliberately a WARNING, not report(): an outage produces one of these per
 * recipient, and routing them through the exception handler would page someone
 * for a degradation the product already absorbs.
 */
class SafeBroadcastChannel
{
    public function __construct(
        private readonly BroadcastChannel $channel,
    ) {}

    public function send(object $notifiable, Notification $notification): mixed
    {
        try {
            return $this->channel->send($notifiable, $notification);
        } catch (\Throwable $e) {
            Log::warning('Notification broadcast skipped; the bell will pick it up on its next poll.', [
                'notification' => $notification::class,
                'notifiable_id' => $notifiable->id ?? null,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }
}
