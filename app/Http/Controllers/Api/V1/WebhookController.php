<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    // BILL-06: Handle Stripe webhooks
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

        switch ($event->type) {
            case 'invoice.payment_succeeded':
                $this->handlePaymentSucceeded($event->data->object);
                break;

            case 'invoice.payment_failed':
                $this->handlePaymentFailed($event->data->object);
                break;

            case 'customer.subscription.deleted':
                $this->handleSubscriptionDeleted($event->data->object);
                break;

            case 'customer.subscription.updated':
                $this->handleSubscriptionUpdated($event->data->object);
                break;

            default:
                Log::info("Unhandled Stripe event: {$event->type}");
        }

        return response()->json(['received' => true]);
    }

    private function handlePaymentSucceeded(object $invoice): void
    {
        $org = Organization::where('stripe_customer_id', $invoice->customer)->first();
        if (!$org) return;

        Log::info("Payment succeeded for org {$org->id}", ['invoice' => $invoice->id]);
    }

    private function handlePaymentFailed(object $invoice): void
    {
        $org = Organization::where('stripe_customer_id', $invoice->customer)->first();
        if (!$org) return;

        Log::warning("Payment failed for org {$org->id}", ['invoice' => $invoice->id]);

        // Could send notification to owner here
    }

    private function handleSubscriptionDeleted(object $subscription): void
    {
        $org = Organization::where('stripe_subscription_id', $subscription->id)->first();
        if (!$org) return;

        $org->update([
            'plan' => 'trial',
            'stripe_subscription_id' => null,
        ]);

        Log::info("Subscription cancelled for org {$org->id}");
    }

    private function handleSubscriptionUpdated(object $subscription): void
    {
        $org = Organization::where('stripe_subscription_id', $subscription->id)->first();
        if (!$org) return;

        Log::info("Subscription updated for org {$org->id}", ['status' => $subscription->status]);
    }
}
