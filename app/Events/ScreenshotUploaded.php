<?php

namespace App\Events;

use App\Models\Screenshot;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ScreenshotUploaded implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Screenshot $screenshot) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('org.' . $this->screenshot->organization_id)];
    }

    public function broadcastWith(): array
    {
        return [
            'user_id' => $this->screenshot->user_id,
            'screenshot_id' => $this->screenshot->id,
            'captured_at' => $this->screenshot->captured_at->toISOString(),
        ];
    }
}
