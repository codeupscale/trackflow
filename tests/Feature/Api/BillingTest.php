<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\User;
use Tests\TestCase;

class BillingTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::factory()->create();
        $this->owner = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'owner']);
        $this->employee = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'employee']);
    }

    public function test_can_get_usage(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/billing/usage');
        $response->assertOk()
            ->assertJsonStructure(['plan', 'used', 'limit', 'overage']);
    }

    public function test_employee_cannot_access_billing(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/billing/usage');
        $response->assertStatus(403);
    }

    public function test_usage_returns_correct_seat_count(): void
    {
        // Create additional users
        User::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'role' => 'employee',
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/billing/usage');
        $response->assertOk();
        // owner + employee + 3 more = 5
        $this->assertEquals(5, $response->json('used'));
    }

    public function test_trial_plan_has_5_seat_limit(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/billing/usage');
        $this->assertEquals(5, $response->json('limit'));
    }
}
