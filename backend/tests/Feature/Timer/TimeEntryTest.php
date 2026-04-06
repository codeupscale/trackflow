<?php

namespace Tests\Feature\Timer;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Tests\TestCase;

class TimeEntryTest extends TestCase
{
    private User $owner;
    private User $employee;
    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->employee = $this->createUser($this->org, 'employee');
    }

    public function test_can_create_manual_time_entry(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
            'notes' => 'Manual entry',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('entry.type', 'manual')
            ->assertJsonStructure(['entry' => ['id', 'duration_seconds']]);
    }

    public function test_can_list_own_entries(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        TimeEntry::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $response = $this->getJson('/api/v1/time-entries');
        $response->assertOk();
        $this->assertCount(3, $response->json('data'));
    }

    public function test_employee_only_sees_own_entries(): void
    {
        $otherEmployee = $this->createUser($this->org, 'employee');

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $otherEmployee->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');
        $response = $this->getJson('/api/v1/time-entries');

        $this->assertCount(1, $response->json('data'));
    }

    public function test_owner_can_see_all_entries(): void
    {
        TimeEntry::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson('/api/v1/time-entries');

        $this->assertCount(3, $response->json('data'));
    }

    public function test_can_approve_time_entry(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'is_approved' => false,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson("/api/v1/time-entries/{$entry->id}/approve");

        $response->assertOk();
        $entry->refresh();
        $this->assertTrue($entry->is_approved);
        $this->assertEquals($this->owner->id, $entry->approved_by);
    }

    public function test_employee_cannot_approve(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');
        $response = $this->postJson("/api/v1/time-entries/{$entry->id}/approve");
        $response->assertStatus(403);
    }

    public function test_can_soft_delete_entry(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');
        $response = $this->deleteJson("/api/v1/time-entries/{$entry->id}");
        $response->assertOk();

        $this->assertSoftDeleted('time_entries', ['id' => $entry->id]);
    }

    public function test_unauthenticated_cannot_access(): void
    {
        $response = $this->getJson('/api/v1/time-entries');
        $response->assertStatus(401);
    }

    public function test_cross_tenant_cannot_access(): void
    {
        $otherOrg = $this->createOrganization();
        $otherUser = $this->createUser($otherOrg, 'owner');

        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($otherUser, 'sanctum');

        // Should not be able to find entry from other org
        $response = $this->getJson("/api/v1/time-entries/{$entry->id}");
        $response->assertStatus(404);
    }
}
