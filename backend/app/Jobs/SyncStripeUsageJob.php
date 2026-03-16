<?php

namespace App\Jobs;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class SyncStripeUsageJob implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 30;

    public function __construct(public string $organizationId)
    {
        $this->onQueue('low');
    }

    public function uniqueId(): string
    {
        return $this->organizationId . '_' . now()->format('Y-m-d-H');
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function handle(): void
    {
        $org = Organization::find($this->organizationId);
        if (!$org || !$org->stripe_subscription_id) {
            return;
        }

        $seatCount = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('is_active', true)
            ->count();

        try {
            $stripe = new \Stripe\StripeClient(config('services.stripe.secret'));
            $subscription = $stripe->subscriptions->retrieve($org->stripe_subscription_id);

            // Check if subscription has items before accessing
            if (empty($subscription->items->data)) {
                Log::warning("Subscription {$org->stripe_subscription_id} has no items");
                return;
            }

            $currentQuantity = $subscription->items->data[0]->quantity ?? 0;

            if ($currentQuantity !== $seatCount) {
                $stripe->subscriptions->update($org->stripe_subscription_id, [
                    'items' => [[
                        'id' => $subscription->items->data[0]->id,
                        'quantity' => $seatCount,
                    ]],
                    'proration_behavior' => 'always_invoice',
                ], ['idempotency_key' => "sync_{$org->id}_{$seatCount}_" . now()->format('Y-m-d-H')]);

                Log::info("Synced seat count for org {$org->id}: {$currentQuantity} → {$seatCount}");
            }
        } catch (\Exception $e) {
            Log::error('SyncStripeUsageJob failed', [
                'organization_id' => $this->organizationId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('SyncStripeUsageJob permanently failed', [
            'organization_id' => $this->organizationId,
            'error' => $exception->getMessage(),
        ]);
    }
}
