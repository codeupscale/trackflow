<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\SendEmailNotificationJob;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    public function stripe(Request $request): JsonResponse
    {
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature');
        $webhookSecret = config('services.stripe.webhook_secret');

        try {
            $event = \Stripe\Webhook::constructEvent($payload, $sigHeader, $webhookSecret);
        } catch (\Stripe\Exception\SignatureVerificationException $e) {
            Log::warning('Stripe webhook signature verification failed.', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Invalid signature.'], 400);
        } catch (\Exception $e) {
            Log::error('Stripe webhook error.', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Webhook error.'], 400);
        }

        match ($event->type) {
            'invoice.payment_succeeded' => $this->handlePaymentSucceeded($event->data->object),
            'invoice.payment_failed' => $this->handlePaymentFailed($event->data->object),
            'customer.subscription.deleted' => $this->handleSubscriptionDeleted($event->data->object),
            'customer.subscription.updated' => $this->handleSubscriptionUpdated($event->data->object),
            default => Log::info("Unhandled Stripe event: {$event->type}"),
        };

        return response()->json(['received' => true]);
    }

    private function handlePaymentSucceeded(object $invoice): void
    {
        $org = Organization::where('stripe_customer_id', $invoice->customer)->first();
        if (!$org) return;

        Log::info("Payment succeeded for org {$org->id}", ['invoice_id' => $invoice->id]);

        // Notify the owner
        $owner = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('role', 'owner')
            ->first();

        if ($owner) {
            SendEmailNotificationJob::dispatch(
                $owner->email,
                'Payment received — TrackFlow',
                'emails.payment-success',
                [
                    'name' => $owner->name,
                    'amount' => number_format(($invoice->amount_paid ?? 0) / 100, 2),
                    'invoice_url' => $invoice->hosted_invoice_url ?? '#',
                ]
            );
        }
    }

    private function handlePaymentFailed(object $invoice): void
    {
        $org = Organization::where('stripe_customer_id', $invoice->customer)->first();
        if (!$org) return;

        Log::warning("Payment failed for org {$org->id}", ['invoice_id' => $invoice->id]);

        // Notify the owner about the payment failure
        $owner = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('role', 'owner')
            ->first();

        if ($owner) {
            SendEmailNotificationJob::dispatch(
                $owner->email,
                'Payment failed — Action required — TrackFlow',
                'emails.payment-failed',
                [
                    'name' => $owner->name,
                    'amount' => number_format(($invoice->amount_due ?? 0) / 100, 2),
                    'invoice_url' => $invoice->hosted_invoice_url ?? '#',
                ]
            );
        }
    }

    private function handleSubscriptionDeleted(object $subscription): void
    {
        $org = Organization::where('stripe_subscription_id', $subscription->id)->first();
        if (!$org) return;

        // Downgrade to trial with 30-day grace period
        $org->update([
            'plan' => 'trial',
            'stripe_subscription_id' => null,
            'trial_ends_at' => now()->addDays(30),
        ]);

        Log::info("Subscription cancelled for org {$org->id}");

        // Notify the owner
        $owner = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('role', 'owner')
            ->first();

        if ($owner) {
            SendEmailNotificationJob::dispatch(
                $owner->email,
                'Subscription cancelled — TrackFlow',
                'emails.subscription-cancelled',
                [
                    'name' => $owner->name,
                    'grace_period_ends' => now()->addDays(30)->format('F j, Y'),
                ]
            );
        }
    }

    private function handleSubscriptionUpdated(object $subscription): void
    {
        $org = Organization::where('stripe_subscription_id', $subscription->id)->first();
        if (!$org) return;

        // Update the plan based on the Stripe subscription price
        $priceId = $subscription->items->data[0]->price->id ?? null;
        if ($priceId) {
            $plan = $this->resolvePlanFromPriceId($priceId);
            if ($plan && $plan !== $org->plan) {
                $org->update(['plan' => $plan]);
                Log::info("Plan updated to {$plan} for org {$org->id}");
            }
        }

        // Handle subscription status changes
        if ($subscription->status === 'past_due') {
            Log::warning("Subscription past due for org {$org->id}");
        } elseif ($subscription->status === 'unpaid') {
            Log::warning("Subscription unpaid for org {$org->id}");
        }
    }

    private function resolvePlanFromPriceId(string $priceId): ?string
    {
        $prices = [
            config('services.stripe.prices.starter_monthly') => 'starter',
            config('services.stripe.prices.starter_annual') => 'starter',
            config('services.stripe.prices.pro_monthly') => 'pro',
            config('services.stripe.prices.pro_annual') => 'pro',
        ];

        return $prices[$priceId] ?? null;
    }
}
