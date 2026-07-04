<?php

namespace App\Events;

use App\Models\Screenshot;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Fired after a screenshot row + its thumbnail/display variants are fully
 * persisted (end of ProcessScreenshotJob). Signals the web dashboard to
 * invalidate its screenshot cache and refetch through the role-scoped REST
 * index — it is a "something changed" ping, NOT a data-carrying event.
 *
 * ShouldBroadcastNow (mirrors TimerStarted): publishes to Reverb synchronously
 * so there's no queue-lag between "screenshot ready" and "visible in dashboard".
 *
 * SECURITY (A01 / broken access control): this event is delivered on the
 * org-wide `org.{id}` channel, which authorizes on org membership only (every
 * role — including employees — subscribes). The frame is therefore visible to
 * ALL org members regardless of their role scope. It MUST NOT carry sensitive
 * or capability data: no signed thumbnail/display URLs (possession = access),
 * no window_title/app_name, no activity metrics. Only non-sensitive routing
 * identifiers are broadcast. Clients refetch the actual rows through the
 * role-scoped REST endpoint, which is the real access-control boundary.
 */
class ScreenshotUploaded implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Screenshot $screenshot) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('org.' . $this->screenshot->organization_id)];
    }

    /**
     * Minimal, non-sensitive payload. screenshot_id is used for keying/logging;
     * user_id lets the client apply its role-scoping predicate before deciding
     * to refetch. No signed URLs or screenshot metadata are ever broadcast.
     */
    public function broadcastWith(): array
    {
        return [
            'screenshot_id' => $this->screenshot->id,
            'user_id'       => $this->screenshot->user_id,
        ];
    }
}
