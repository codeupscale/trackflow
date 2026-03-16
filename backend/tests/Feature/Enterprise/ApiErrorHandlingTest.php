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
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id, 'role' => 'admin']);

        $response = $this->actingAs($user)
            ->getJson('/api/v1/time-entries/nonexistent-uuid-here');

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
        $org = Organization::factory()->create();
        $employee = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

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
