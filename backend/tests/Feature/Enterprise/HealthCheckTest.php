<?php

namespace Tests\Feature\Enterprise;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_endpoint_returns_response(): void
    {
        $response = $this->getJson('/api/v1/health');

        // Health may return 200 (ok) or 503 (degraded) depending on services available
        $response->assertJsonStructure([
            'status',
            'version',
            'environment',
            'timestamp',
            'checks' => ['database', 'redis', 'queue', 'storage'],
            'timings',
            'memory' => ['usage_mb', 'peak_mb'],
        ]);

        $this->assertContains($response->status(), [200, 503]);
    }

    public function test_liveness_probe(): void
    {
        $response = $this->getJson('/api/v1/health/live');

        $response->assertStatus(200)
            ->assertJson(['status' => 'ok']);
    }

    public function test_health_returns_correct_structure(): void
    {
        $response = $this->getJson('/api/v1/health');
        $data = $response->json();

        $this->assertIsString($data['status']);
        $this->assertContains($data['status'], ['ok', 'degraded']);
        $this->assertIsString($data['timestamp']);
        $this->assertIsNumeric($data['memory']['usage_mb']);
    }
}
