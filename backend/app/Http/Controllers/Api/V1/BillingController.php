<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class BillingController extends Controller
{
    // BILL-01: Subscribe (upgrade from trial)
    public function subscribe(Request $request): JsonResponse
    {
        $request->validate([
            'plan' => 'required|in:starter,pro',
            'interval' => 'required|in:monthly,annual',
            'payment_method_id' => 'required|string',
        ]);

        $user = $request->user();
        $org = $user->organization;

        if (!$user->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Only owners/admins can manage billing.'], 403);
        }

        $stripe = new \Stripe\StripeClient(config('services.stripe.secret'));

        // Create or retrieve Stripe customer
        if (!$org->stripe_customer_id) {
            $customer = $stripe->customers->create([
                'name' => $org->name,
                'email' => $user->email,
                'metadata' => ['org_id' => $org->id],
            ]);
            $org->update(['stripe_customer_id' => $customer->id]);
        }

        // Attach payment method
        $stripe->paymentMethods->attach($request->payment_method_id, [
            'customer' => $org->stripe_customer_id,
        ]);

        $stripe->customers->update($org->stripe_customer_id, [
            'invoice_settings' => ['default_payment_method' => $request->payment_method_id],
        ]);

        // Get price ID from config
        $priceId = $this->getPriceId($request->plan, $request->interval);

        // Count active seats
        $seatCount = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('is_active', true)
            ->count();

        // Create subscription
        $subscription = $stripe->subscriptions->create([
            'customer' => $org->stripe_customer_id,
            'items' => [['price' => $priceId, 'quantity' => $seatCount]],
            'payment_behavior' => 'default_incomplete',
            'payment_settings' => ['save_default_payment_method' => 'on_subscription'],
            'expand' => ['latest_invoice.payment_intent'],
        ], ['idempotency_key' => "sub_{$org->id}_{$request->plan}_{$request->interval}"]);

        $org->update([
            'stripe_subscription_id' => $subscription->id,
            'plan' => $request->plan,
        ]);

        return response()->json([
            'subscription_id' => $subscription->id,
            'client_secret' => $subscription->latest_invoice->payment_intent->client_secret ?? null,
            'status' => $subscription->status,
        ]);
    }

    // BILL-02: Change plan
    public function changePlan(Request $request): JsonResponse
    {
        $request->validate([
            'plan' => 'required|in:starter,pro',
            'interval' => 'required|in:monthly,annual',
        ]);

        $user = $request->user();
        $org = $user->organization;

        if (!$user->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Only owners/admins can manage billing.'], 403);
        }

        if (!$org->stripe_subscription_id) {
            return response()->json(['message' => 'No active subscription found.'], 400);
        }

        $stripe = new \Stripe\StripeClient(config('services.stripe.secret'));

        $subscription = $stripe->subscriptions->retrieve($org->stripe_subscription_id);
        $priceId = $this->getPriceId($request->plan, $request->interval);

        // Determine if upgrade or downgrade
        $isUpgrade = $this->isUpgrade($org->plan, $request->plan);

        $stripe->subscriptions->update($org->stripe_subscription_id, [
            'items' => [[
                'id' => $subscription->items->data[0]->id,
                'price' => $priceId,
            ]],
            'proration_behavior' => $isUpgrade ? 'always_invoice' : 'none',
            'cancel_at_period_end' => false,
        ], ['idempotency_key' => "change_{$org->id}_{$request->plan}_{$request->interval}_" . time()]);

        $org->update(['plan' => $request->plan]);

        return response()->json([
            'message' => $isUpgrade ? 'Plan upgraded immediately.' : 'Plan will change at end of billing period.',
            'plan' => $request->plan,
        ]);
    }

    // BILL-03: Cancel subscription
    public function cancel(Request $request): JsonResponse
    {
        $user = $request->user();
        $org = $user->organization;

        if (!$user->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Only owners/admins can manage billing.'], 403);
        }

        if (!$org->stripe_subscription_id) {
            return response()->json(['message' => 'No active subscription.'], 400);
        }

        $stripe = new \Stripe\StripeClient(config('services.stripe.secret'));

        $subscription = $stripe->subscriptions->update($org->stripe_subscription_id, [
            'cancel_at_period_end' => true,
        ]);

        return response()->json([
            'message' => 'Subscription will cancel at end of period.',
            'cancel_at' => date('Y-m-d', $subscription->current_period_end),
        ]);
    }

    // BILL-04: List invoices
    public function invoices(Request $request): JsonResponse
    {
        $org = $request->user()->organization;

        if (!$org->stripe_customer_id) {
            return response()->json(['invoices' => []]);
        }

        $stripe = new \Stripe\StripeClient(config('services.stripe.secret'));

        $invoices = $stripe->invoices->all([
            'customer' => $org->stripe_customer_id,
            'limit' => 24,
        ]);

        $data = collect($invoices->data)->map(fn($inv) => [
            'id' => $inv->id,
            'number' => $inv->number,
            'amount' => $inv->amount_due / 100,
            'currency' => $inv->currency,
            'status' => $inv->status,
            'date' => date('Y-m-d', $inv->created),
            'pdf_url' => $inv->invoice_pdf,
            'hosted_url' => $inv->hosted_invoice_url,
        ]);

        return response()->json(['invoices' => $data]);
    }

    // BILL-05: Usage / seat count
    public function usage(Request $request): JsonResponse
    {
        $org = $request->user()->organization;

        $used = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('is_active', true)
            ->count();

        $limits = [
            'trial' => 5,
            'starter' => 20,
            'pro' => PHP_INT_MAX,
            'enterprise' => PHP_INT_MAX,
        ];

        $limit = $limits[$org->plan] ?? 5;
        $overage = max(0, $used - $limit);

        return response()->json([
            'plan' => $org->plan,
            'used' => $used,
            'limit' => $limit === PHP_INT_MAX ? 'unlimited' : $limit,
            'overage' => $overage,
            'trial_ends_at' => $org->trial_ends_at,
        ]);
    }

    private function getPriceId(string $plan, string $interval): string
    {
        $key = strtoupper("STRIPE_PRICE_{$plan}_{$interval}");
        return config("services.stripe.prices.{$plan}_{$interval}") ?? env($key, '');
    }

    private function isUpgrade(string $currentPlan, string $newPlan): bool
    {
        $order = ['trial' => 0, 'starter' => 1, 'pro' => 2, 'enterprise' => 3];
        return ($order[$newPlan] ?? 0) > ($order[$currentPlan] ?? 0);
    }
}
