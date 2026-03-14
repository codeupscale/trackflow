<?php

namespace App\Events;

use App\Models\User;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class EmployeeIdle implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public User $user,
        public string $idleSince
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('org.' . $this->user->organization_id)];
    }

    public function broadcastWith(): array
    {
        return [
            'user_id' => $this->user->id,
            'idle_since' => $this->idleSince,
        ];
    }
}
