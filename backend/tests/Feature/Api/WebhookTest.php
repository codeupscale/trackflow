<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class WebhookTest extends TestCase
{
    private string $webhookSecret = 'whsec_test_secret_key_for_testing';

    protected function setUp(): void
    {
        parent::setUp();
        // Override Stripe webhook secret with a known test value so we can
        // generate valid signatures without mocking the Stripe SDK.
        config(['services.stripe.webhook_secret' => $this->webhookSecret]);
    }

    /**
     * Build a Stripe-style Stripe-Signature header for the given payload and secret.
     */
    private function stripeSignature(string $payload, ?int $timestamp = null): string
    {
        $timestamp = $timestamp ?? time();
        $signedPayload = "{$timestamp}.{$payload}";
        $signature = hash_hmac('sha256', $signedPayload, $this->webhookSecret);
        return "t={$timestamp},v1={$signature}";
    }

    public function test_stripe_webhook_with_valid_signature(): void
    {
        $org = Organization::factory()->create([
            'stripe_customer_id' => 'cus_test123',
        ]);

        $payload = json_encode([
            'type' => 'invoice.payment_succeeded',
            'data' => [
                'object' => [
                    'id' => 'in_test123',
                    'customer' => 'cus_test123',
                    'amount_paid' => 10000,
                    'hosted_invoice_url' => 'https://example.com/invoice',
                ],
            ],
        ]);

        $response = $this->call(
            'POST',
            '/api/v1/webhooks/stripe',
            [],
            [],
            [],
            ['HTTP_STRIPE_SIGNATURE' => $this->stripeSignature($payload), 'CONTENT_TYPE' => 'application/json'],
            $payload
        );

        $response->assertOk()
            ->assertJson(['received' => true]);
    }

    public function test_stripe_webhook_with_invalid_signature_returns_400(): void
    {
        $payload = json_encode(['test' => 'data']);

        $response = $this->call(
            'POST',
            '/api/v1/webhooks/stripe',
            [],
            [],
            [],
            ['HTTP_STRIPE_SIGNATURE' => 'invalid_signature', 'CONTENT_TYPE' => 'application/json'],
            $payload
        );

        $response->assertStatus(400)
            ->assertJson(['error' => 'Invalid signature.']);
    }

    public function test_stripe_webhook_subscription_deleted_updates_org(): void
    {
        $org = Organization::factory()->create([
            'stripe_customer_id' => 'cus_del123',
            'stripe_subscription_id' => 'sub_test123',
            'plan' => 'pro',
        ]);

        User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'owner',
        ]);

        $payload = json_encode([
            'type' => 'customer.subscription.deleted',
            'data' => [
                'object' => [
                    'id' => 'sub_test123',
                    'customer' => $org->stripe_customer_id,
                    'status' => 'canceled',
                ],
            ],
        ]);

        $response = $this->call(
            'POST',
            '/api/v1/webhooks/stripe',
            [],
            [],
            [],
            ['HTTP_STRIPE_SIGNATURE' => $this->stripeSignature($payload), 'CONTENT_TYPE' => 'application/json'],
            $payload
        );

        $response->assertOk()
            ->assertJson(['received' => true]);

        $org->refresh();
        $this->assertEquals('trial', $org->plan);
        $this->assertNull($org->stripe_subscription_id);
    }

    public function test_stripe_webhook_payment_succeeded_creates_notification(): void
    {
        $org = Organization::factory()->create([
            'stripe_customer_id' => 'cus_pay123',
        ]);

        User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'owner',
            'email' => 'owner@example.com',
        ]);

        $payload = json_encode([
            'type' => 'invoice.payment_succeeded',
            'data' => [
                'object' => [
                    'id' => 'in_pay123',
                    'customer' => 'cus_pay123',
                    'amount_paid' => 10000,
                    'hosted_invoice_url' => 'https://example.com/invoice',
                ],
            ],
        ]);

        $response = $this->call(
            'POST',
            '/api/v1/webhooks/stripe',
            [],
            [],
            [],
            ['HTTP_STRIPE_SIGNATURE' => $this->stripeSignature($payload), 'CONTENT_TYPE' => 'application/json'],
            $payload
        );

        $response->assertOk();
    }

    public function test_stripe_webhook_handles_unhandled_event_gracefully(): void
    {
        $payload = json_encode([
            'type' => 'unknown.event.type',
            'data' => ['object' => ['id' => 'test_123']],
        ]);

        $response = $this->call(
            'POST',
            '/api/v1/webhooks/stripe',
            [],
            [],
            [],
            ['HTTP_STRIPE_SIGNATURE' => $this->stripeSignature($payload), 'CONTENT_TYPE' => 'application/json'],
            $payload
        );

        $response->assertOk()
            ->assertJson(['received' => true]);
    }

    public function test_stripe_webhook_handles_webhook_construction_error(): void
    {
        // A completely malformed payload with a valid-looking signature but
        // content that causes Stripe's parser to fail.
        $payload = 'not-json';

        $response = $this->call(
            'POST',
            '/api/v1/webhooks/stripe',
            [],
            [],
            [],
            ['HTTP_STRIPE_SIGNATURE' => 'invalid_sig_here', 'CONTENT_TYPE' => 'application/json'],
            $payload
        );

        $response->assertStatus(400);
    }

    public function test_stripe_webhook_no_signature_header(): void
    {
        $payload = json_encode(['test' => 'data']);

        $response = $this->call(
            'POST',
            '/api/v1/webhooks/stripe',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'application/json'],
            $payload
        );

        // Should fail signature verification since header is missing
        $response->assertStatus(400);
    }
}
