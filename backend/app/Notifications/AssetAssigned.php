<?php

namespace App\Notifications;

use App\Models\Asset;
use Carbon\Carbon;

/**
 * A company item was handed to you. Sent to the new holder.
 *
 * It doubles as the written record of receipt: the tag and the condition at
 * hand-over are in it, so "it was already scratched when I got it" has a
 * timestamped answer on both sides.
 */
class AssetAssigned extends TrackflowNotification
{
    public function __construct(
        private readonly Asset $asset,
        private readonly string $assignedByName,
        private readonly ?string $expectedReturnOn = null,
    ) {}

    public function category(): string
    {
        return 'asset.assigned_to_you';
    }

    public function title(object $notifiable): string
    {
        return "{$this->asset->name} has been assigned to you";
    }

    public function body(object $notifiable): string
    {
        $parts = ["{$this->asset->asset_tag} · condition: {$this->asset->condition}, from {$this->assignedByName}."];

        if ($this->expectedReturnOn) {
            $parts[] = 'Please return it by ' . Carbon::parse($this->expectedReturnOn)->format('d M Y') . '.';
        }

        return implode(' ', $parts);
    }

    public function url(object $notifiable): string
    {
        return '/hr/assets';
    }

    public function meta(object $notifiable): array
    {
        return [
            'asset_id' => $this->asset->id,
            'asset_tag' => $this->asset->asset_tag,
        ];
    }
}
