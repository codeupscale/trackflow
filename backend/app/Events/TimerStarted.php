<?php

namespace App\Events;

use App\Models\TimeEntry;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Contracts\Broadcasting\ShouldRescue;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

// ShouldBroadcastNow (not ShouldBroadcast): publish to Reverb synchronously so the
// web dashboard reflects start/stop in real time instead of waiting for its 10s poll.
//
// ShouldRescue: Laravel broadcasts an event BEFORE it runs the event's listeners, so
// without this a Reverb outage threw out of event() and AutoCheckInOnTimerStart never
// ran — the session was stored but the employee was silently never checked in. With
// it, a failed broadcast is report()ed and the listeners still run.
class TimerStarted implements ShouldBroadcastNow, ShouldRescue
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public TimeEntry $entry) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('org.' . $this->entry->organization_id)];
    }

    public function broadcastWith(): array
    {
        return [
            'user_id' => $this->entry->user_id,
            'entry_id' => $this->entry->id,
            'project_id' => $this->entry->project_id,
            'started_at' => $this->entry->started_at->toISOString(),
        ];
    }
}
