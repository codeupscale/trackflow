<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * @group external
 */
class WebhookTest extends TestCase
{
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

        // Mock Stripe webhook verification (consistent with other tests)
        \Stripe\Webhook::shouldReceive('constructEvent')
            ->once()
            ->andReturn((object)[
                'type' => 'invoice.payment_succeeded',
                'data' => (object)[
                    'object' => (object)[
                        'id' => 'in_test123',
                        'customer' => 'cus_test123',
                        'amount_paid' => 10000,
                        'hosted_invoice_url' => 'https://example.com/invoice',
                    ],
                ],
            ]);

        Log::shouldReceive('info')->once();

        $response = $this->postJson('/api/v1/webhooks/stripe', $payload, [
            'Stripe-Signature' => 'valid_sig_test',
            'Content-Type' => 'application/json',
        ]);

        $response->assertOk()
            ->assertJson(['received' => true]);
    }

    public function test_stripe_webhook_with_invalid_signature_returns_400(): void
    {
        $payload = json_encode(['test' => 'data']);

        // Simulate signature verification failure by mocking
        \Stripe\Webhook::shouldReceive('constructEvent')
            ->once()
            ->andThrow(new \Stripe\Exception\SignatureVerificationException(
                'sig_test',
                'Invalid signature'
            ));

        Log::shouldReceive('warning')->once();

        $response = $this->postJson('/api/v1/webhooks/stripe', $payload, [
            'Stripe-Signature' => 'invalid_sig',
            'Content-Type' => 'application/json',
        ]);

        $response->assertStatus(400)
            ->assertJson(['error' => 'Invalid signature.']);
    }

    public function test_stripe_webhook_subscription_deleted_updates_org(): void
    {
        $org = Organization::factory()->create([
            'stripe_subscription_id' => 'sub_test123',
            'plan' => 'pro',
        ]);

        User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'owner',
        ]);

        // Mock the webhook event
        \Stripe\Webhook::shouldReceive('constructEvent')
            ->once()
            ->andReturn((object)[
                'type' => 'customer.subscription.deleted',
                'data' => (object)[
                    'object' => (object)[
                        'id' => 'sub_test123',
                        'customer' => $org->stripe_customer_id,
                        'status' => 'canceled',
                    ],
                ],
            ]);

        Log::shouldReceive('info')->once();

        $response = $this->postJson('/api/v1/webhooks/stripe', json_encode([
            'type' => 'customer.subscription.deleted',
            'data' => [
                'object' => [
                    'id' => 'sub_test123',
                ],
            ],
        ]), [
            'Stripe-Signature' => 'valid_sig_test',
            'Content-Type' => 'application/json',
        ]);

        $response->assertOk()
            ->assertJson(['received' => true]);

        $org->refresh();
        $this->assertEquals('trial', $org->plan);
        $this->assertNull($org->stripe_subscription_id);
    }

    public function test_stripe_webhook_payment_succeeded_creates_notification(): void
    {
        $org = Organization::factory()->create([
            'stripe_customer_id' => 'cus_test123',
        ]);

        User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'owner',
            'email' => 'owner@example.com',
        ]);

        \Stripe\Webhook::shouldReceive('constructEvent')
            ->once()
            ->andReturn((object)[
                'type' => 'invoice.payment_succeeded',
                'data' => (object)[
                    'object' => (object)[
                        'id' => 'in_test123',
                        'customer' => 'cus_test123',
                        'amount_paid' => 10000,
                        'hosted_invoice_url' => 'https://example.com/invoice',
                    ],
                ],
            ]);

        Log::shouldReceive('info')->once();

        $response = $this->postJson('/api/v1/webhooks/stripe', json_encode([
            'type' => 'invoice.payment_succeeded',
            'data' => [
                'object' => [
                    'id' => 'in_test123',
                    'customer' => 'cus_test123',
                    'amount_paid' => 10000,
                ],
            ],
        ]), [
            'Stripe-Signature' => 'valid_sig_test',
            'Content-Type' => 'application/json',
        ]);

        $response->assertOk();
    }

    public function test_stripe_webhook_handles_unhandled_event_gracefully(): void
    {
        \Stripe\Webhook::shouldReceive('constructEvent')
            ->once()
            ->andReturn((object)[
                'type' => 'unknown.event.type',
                'data' => (object)[
                    'object' => (object)[
                        'id' => 'test_123',
                    ],
                ],
            ]);

        Log::shouldReceive('info')->once();

        $response = $this->postJson('/api/v1/webhooks/stripe', json_encode([
            'type' => 'unknown.event.type',
            'data' => ['object' => ['id' => 'test_123']],
        ]), [
            'Stripe-Signature' => 'valid_sig_test',
            'Content-Type' => 'application/json',
        ]);

        $response->assertOk()
            ->assertJson(['received' => true]);
    }

    public function test_stripe_webhook_handles_webhook_construction_error(): void
    {
        \Stripe\Webhook::shouldReceive('constructEvent')
            ->once()
            ->andThrow(new \Exception('Webhook error'));

        Log::shouldReceive('error')->once();

        $response = $this->postJson('/api/v1/webhooks/stripe', json_encode(['test' => 'data']), [
            'Stripe-Signature' => 'valid_sig_test',
            'Content-Type' => 'application/json',
        ]);

        $response->assertStatus(400)
            ->assertJson(['error' => 'Webhook error.']);
    }

    public function test_stripe_webhook_no_signature_header(): void
    {
        $response = $this->postJson('/api/v1/webhooks/stripe', json_encode(['test' => 'data']), [
            'Content-Type' => 'application/json',
        ]);

        // Should fail signature verification since header is missing
        $response->assertStatus(400);
    }
}
