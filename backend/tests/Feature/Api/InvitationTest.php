<?php

namespace Tests\Feature\Api;

use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Str;
use Tests\TestCase;

class InvitationTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $manager;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::factory()->create([
            'plan' => 'trial',
        ]);

        $this->owner = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'owner',
        ]);

        $this->manager = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'manager',
        ]);
    }

    public function test_owner_can_create_invitation(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $email = 'new.user+' . Str::random(6) . '@example.com';
        $response = $this->postJson('/api/v1/invitations', [
            'email' => $email,
            'role' => 'employee',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('invitation.email', strtolower($email))
            ->assertJsonPath('message', 'Invitation sent successfully.');
    }

    public function test_manager_cannot_create_invitation(): void
    {
        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'someone@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(403);
    }

    public function test_invite_is_blocked_when_seat_limit_reached(): void
    {
        // Trial has 5 seats. We already have owner + manager = 2.
        User::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'role' => 'employee',
            'is_active' => true,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'over.limit@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(402)
            ->assertJsonPath('message', 'Seat limit reached. Please upgrade your plan.')
            ->assertJsonStructure(['current_seats', 'seat_limit', 'upgrade_url']);
    }

    public function test_pending_invite_check_is_org_scoped(): void
    {
        $otherOrg = Organization::factory()->create(['plan' => 'trial']);
        $otherOwner = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'owner']);

        $email = 'shared@example.com';

        Invitation::factory()->create([
            'organization_id' => $otherOrg->id,
            'created_by' => $otherOwner->id,
            'email' => $email,
            'accepted_at' => null,
            'expires_at' => now()->addDays(7),
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => $email,
            'role' => 'employee',
        ]);

        $response->assertStatus(201);
    }

    public function test_index_returns_paginated_envelope_and_backward_compat_key(): void
    {
        Invitation::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/invitations?per_page=2&page=1');

        $response->assertOk()
            ->assertJsonStructure([
                'data',
                'meta' => ['current_page', 'last_page', 'total', 'per_page'],
                'invitations',
            ]);

        $this->assertCount(2, $response->json('data'));
        $this->assertCount(2, $response->json('invitations'));
    }
}

