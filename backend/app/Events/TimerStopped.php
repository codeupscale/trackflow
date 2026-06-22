<?php

namespace App\Events;

use App\Models\TimeEntry;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

// ShouldBroadcastNow (not ShouldBroadcast): publish to Reverb synchronously during
// the stop request instead of queuing the broadcast through Horizon. The queue hop
// delayed the web dashboard's real-time stop, forcing it to wait for the 10s status
// poll ("web keeps counting after I click Stop").
class TimerStopped implements ShouldBroadcastNow
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
            'ended_at' => $this->entry->ended_at->toISOString(),
            'duration_seconds' => $this->entry->duration_seconds,
        ];
    }
}
