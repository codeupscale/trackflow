<?php

namespace App\Events;

use App\Models\TimeEntry;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TimerStarted implements ShouldBroadcast
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
