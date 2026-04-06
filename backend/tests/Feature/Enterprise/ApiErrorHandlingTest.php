<?php

namespace Tests\Feature\Enterprise;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiErrorHandlingTest extends TestCase
{
    use RefreshDatabase;

    public function test_404_returns_consistent_error_format(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'admin');

        // Use a valid UUID format that doesn't exist — PostgreSQL rejects non-UUID strings
        $fakeUuid = '00000000-0000-0000-0000-000000000000';

        $response = $this->actingAs($user)
            ->getJson("/api/v1/time-entries/{$fakeUuid}");

        $response->assertStatus(404)
            ->assertJsonStructure(['error' => ['code', 'message']]);
    }

    public function test_validation_error_returns_consistent_format(): void
    {
        $response = $this->postJson('/api/v1/auth/register', []);

        $response->assertStatus(422)
            ->assertJsonStructure([
                'error' => ['code', 'message', 'details'],
            ])
            ->assertJsonPath('error.code', 'validation_error');
    }

    public function test_403_returns_consistent_format(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        $response = $this->actingAs($employee)->getJson('/api/v1/audit-logs');

        $response->assertStatus(403)
            ->assertJsonStructure(['error' => ['code', 'message']]);
    }

    public function test_unauthenticated_returns_consistent_format(): void
    {
        $response = $this->getJson('/api/v1/auth/me');

        $response->assertStatus(401);
    }
}
