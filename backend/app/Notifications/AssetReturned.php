<?php

namespace App\Notifications;

use App\Models\Asset;

/**
 * Your return of a company item was recorded. Sent to the former holder.
 *
 * The employee's proof that they handed it back, and in what condition —
 * the other half of the record AssetAssigned starts.
 */
class AssetReturned extends TrackflowNotification
{
    public function __construct(
        private readonly Asset $asset,
        private readonly string $receivedByName,
        private readonly string $condition,
    ) {}

    public function category(): string
    {
        return 'asset.return_recorded';
    }

    public function title(object $notifiable): string
    {
        return "Return recorded: {$this->asset->name}";
    }

    public function body(object $notifiable): string
    {
        return "{$this->asset->asset_tag} received by {$this->receivedByName} on "
            . now()->format('d M Y') . ", condition: {$this->condition}.";
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
            'condition' => $this->condition,
        ];
    }
}
