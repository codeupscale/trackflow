<?php

namespace Tests\Feature\Enterprise;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SecurityHeadersTest extends TestCase
{
    use RefreshDatabase;

    public function test_api_returns_security_headers(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('X-Frame-Options', 'DENY');
        $response->assertHeader('X-XSS-Protection', '1; mode=block');
        $response->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->assertHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    }

    public function test_api_returns_request_id(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertHeader('X-Request-ID');
    }

    public function test_request_id_is_propagated(): void
    {
        $requestId = 'test-request-id-12345';

        $response = $this->withHeader('X-Request-ID', $requestId)
            ->getJson('/api/v1/health');

        $response->assertHeader('X-Request-ID', $requestId);
    }
}
