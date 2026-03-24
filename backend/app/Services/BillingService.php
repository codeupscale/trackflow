<?php

namespace App\Services;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Stripe\StripeClient;

class BillingService
{
    private StripeClient $stripe;

    public function __construct()
    {
        $this->stripe = new StripeClient(config('services.stripe.secret'));
    }

    /**
     * Get or create a Stripe customer for the organization.
     */
    public function getOrCreateStripeCustomer(Organization $org, ?string $email = null): string
    {
        if ($org->stripe_customer_id) {
            return $org->stripe_customer_id;
        }

        $customer = $this->stripe->customers->create([
            'name' => $org->name,
            'email' => $email,
            'metadata' => ['org_id' => $org->id],
        ]);

        $org->update(['stripe_customer_id' => $customer->id]);

        return $customer->id;
    }

    /**
     * Create a new subscription for the organization.
     *
     * @return array{subscription_id: string, client_secret: string|null, status: string}
     */
    public function subscribe(
        Organization $org,
        string $plan,
        string $interval,
        string $paymentMethodId,
        ?string $email = null
    ): array {
        $customerId = $this->getOrCreateStripeCustomer($org, $email);

        // Attach payment method
        $this->stripe->paymentMethods->attach($paymentMethodId, [
            'customer' => $customerId,
        ]);

        $this->stripe->customers->update($customerId, [
            'invoice_settings' => ['default_payment_method' => $paymentMethodId],
        ]);

        $priceId = $this->getPriceId($plan, $interval);
        $seatCount = $this->countActiveSeats($org);

        $subscription = $this->stripe->subscriptions->create([
            'customer' => $customerId,
            'items' => [['price' => $priceId, 'quantity' => $seatCount]],
            'payment_behavior' => 'default_incomplete',
            'payment_settings' => ['save_default_payment_method' => 'on_subscription'],
            'expand' => ['latest_invoice.payment_intent'],
        ], ['idempotency_key' => "sub_{$org->id}_{$plan}_{$interval}"]);

        $org->update([
            'stripe_subscription_id' => $subscription->id,
            'plan' => $plan,
        ]);

        return [
            'subscription_id' => $subscription->id,
            'client_secret' => $subscription->latest_invoice->payment_intent->client_secret ?? null,
            'status' => $subscription->status,
        ];
    }

    /**
     * Change the organization's subscription plan.
     *
     * @return array{message: string, plan: string}
     */
    public function changePlan(Organization $org, string $newPlan, string $interval): array
    {
        if (!$org->stripe_subscription_id) {
            throw new \RuntimeException('No active subscription found.');
        }

        $subscription = $this->stripe->subscriptions->retrieve($org->stripe_subscription_id);
        $priceId = $this->getPriceId($newPlan, $interval);
        $isUpgrade = $this->isUpgrade($org->plan, $newPlan);

        $this->stripe->subscriptions->update($org->stripe_subscription_id, [
            'items' => [[
                'id' => $subscription->items->data[0]->id,
                'price' => $priceId,
            ]],
            'proration_behavior' => $isUpgrade ? 'always_invoice' : 'none',
            'cancel_at_period_end' => false,
        ], ['idempotency_key' => "change_{$org->id}_{$newPlan}_{$interval}_" . time()]);

        $org->update(['plan' => $newPlan]);

        $message = $isUpgrade
            ? 'Plan upgraded immediately.'
            : 'Plan will change at end of billing period.';

        return ['message' => $message, 'plan' => $newPlan];
    }

    /**
     * Cancel the organization's subscription at the end of the billing period.
     *
     * @return array{message: string, cancel_at: string}
     */
    public function cancelSubscription(Organization $org): array
    {
        if (!$org->stripe_subscription_id) {
            throw new \RuntimeException('No active subscription.');
        }

        $subscription = $this->stripe->subscriptions->update($org->stripe_subscription_id, [
            'cancel_at_period_end' => true,
        ]);

        return [
            'message' => 'Subscription will cancel at end of period.',
            'cancel_at' => date('Y-m-d', $subscription->current_period_end),
        ];
    }

    /**
     * Get invoices for the organization.
     */
    public function getInvoices(Organization $org): array
    {
        if (!$org->stripe_customer_id) {
            return [];
        }

        $limit = config('billing.invoice_limit', 24);

        $invoices = $this->stripe->invoices->all([
            'customer' => $org->stripe_customer_id,
            'limit' => $limit,
        ]);

        return collect($invoices->data)->map(fn ($inv) => [
            'id' => $inv->id,
            'number' => $inv->number,
            'amount' => $inv->amount_due / 100,
            'currency' => $inv->currency,
            'status' => $inv->status,
            'date' => date('Y-m-d', $inv->created),
            'pdf_url' => $inv->invoice_pdf,
            'hosted_url' => $inv->hosted_invoice_url,
        ])->all();
    }

    /**
     * Get seat usage for the organization.
     */
    public function getUsage(Organization $org): array
    {
        $used = $this->countActiveSeats($org);
        $seatLimit = $this->getSeatLimit($org->plan);
        $isUnlimited = $seatLimit === null;
        $overage = $isUnlimited ? 0 : max(0, $used - $seatLimit);

        return [
            'plan' => $org->plan,
            'used' => $used,
            'limit' => $isUnlimited ? 'unlimited' : $seatLimit,
            'overage' => $overage,
            'trial_ends_at' => $org->trial_ends_at,
        ];
    }

    /**
     * Reconcile seat quantity on the Stripe subscription to match active user count.
     */
    public function reconcileSeats(Organization $org): void
    {
        if (!$org->stripe_subscription_id) {
            return;
        }

        $seatCount = $this->countActiveSeats($org);
        $subscription = $this->stripe->subscriptions->retrieve($org->stripe_subscription_id);

        $this->stripe->subscriptionItems->update($subscription->items->data[0]->id, [
            'quantity' => $seatCount,
        ]);
    }

    /**
     * Get the Stripe price ID for a plan and interval combination.
     */
    public function getPriceId(string $plan, string $interval): string
    {
        $priceId = config("services.stripe.prices.{$plan}_{$interval}");

        if (!$priceId) {
            $key = strtoupper("STRIPE_PRICE_{$plan}_{$interval}");
            $priceId = env($key, '');
        }

        if (!$priceId) {
            throw new \InvalidArgumentException("No Stripe price configured for {$plan}/{$interval}.");
        }

        return $priceId;
    }

    /**
     * Determine if changing from current plan to new plan is an upgrade.
     */
    private function isUpgrade(string $currentPlan, string $newPlan): bool
    {
        $currentRank = config("billing.plans.{$currentPlan}.rank", 0);
        $newRank = config("billing.plans.{$newPlan}.rank", 0);

        return $newRank > $currentRank;
    }

    /**
     * Count active seats (users) for an organization.
     */
    private function countActiveSeats(Organization $org): int
    {
        return User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('is_active', true)
            ->count();
    }

    /**
     * Get the seat limit for a plan. Returns null for unlimited.
     */
    private function getSeatLimit(string $plan): ?int
    {
        return config("billing.plans.{$plan}.seat_limit");
    }
}
