<?php

namespace Tests\Feature\Auth;

use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Str;
use Tests\TestCase;

class InvitationTest extends TestCase
{
    /** AUTH-09: Owner can create invitation */
    public function test_owner_can_create_invitation(): void
    {
        $user = $this->actingAsUser('owner');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'newuser@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure(['invitation' => ['id', 'email', 'role', 'token']]);

        $this->assertDatabaseHas('invitations', [
            'email' => 'newuser@example.com',
            'role' => 'employee',
            'organization_id' => $user->organization_id,
        ]);
    }

    /** AUTH-09: Admin can create invitation */
    public function test_admin_can_create_invitation(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'newuser@example.com',
            'role' => 'manager',
        ]);

        $response->assertStatus(201);
    }

    /** AUTH-09: Manager CAN create invitation (team.invite granted in RBAC) */
    public function test_manager_can_create_invitation(): void
    {
        $this->actingAsUser('manager');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'newuser@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(201);
    }

    /** AUTH-09: Employee cannot create invitation */
    public function test_employee_cannot_create_invitation(): void
    {
        $this->actingAsUser('employee');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'newuser@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(403);
    }

    /** AUTH-09: Cannot invite existing org member */
    public function test_cannot_invite_existing_org_member(): void
    {
        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');
        $existing = $this->createUser($org, 'employee', ['email' => 'existing@example.com']);

        $this->actingAs($owner, 'sanctum');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'existing@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(422);
    }

    /** AUTH-09: Unauthenticated cannot invite */
    public function test_unauthenticated_cannot_create_invitation(): void
    {
        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'test@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(401);
    }

    public function test_owner_can_list_pending_invitations(): void
    {
        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');
        $this->actingAs($owner, 'sanctum');

        Invitation::factory()->create([
            'organization_id' => $org->id,
            'email' => 'pending@example.com',
            'accepted_at' => null,
            'expires_at' => now()->addDays(3),
            'created_by' => $owner->id,
        ]);

        // Expired should not show
        Invitation::factory()->expired()->create([
            'organization_id' => $org->id,
            'email' => 'expired@example.com',
            'created_by' => $owner->id,
        ]);

        $res = $this->getJson('/api/v1/invitations');
        $res->assertOk()
            ->assertJsonStructure(['data', 'meta', 'invitations'])
            ->assertJsonFragment(['email' => 'pending@example.com'])
            ->assertJsonMissing(['email' => 'expired@example.com']);
    }

    public function test_can_invite_same_email_in_different_organizations(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();
        $ownerA = $this->createUser($orgA, 'owner');
        $ownerB = $this->createUser($orgB, 'owner');

        // Create pending invite in org A
        $this->actingAs($ownerA, 'sanctum');
        $resA = $this->postJson('/api/v1/invitations', [
            'email' => 'duplicate@example.com',
            'role' => 'employee',
        ]);
        $resA->assertStatus(201);

        // Invite same email in org B should still succeed
        $this->actingAs($ownerB, 'sanctum');
        $resB = $this->postJson('/api/v1/invitations', [
            'email' => 'duplicate@example.com',
            'role' => 'employee',
        ]);
        $resB->assertStatus(201);
    }

    public function test_cannot_invite_when_seat_limit_reached(): void
    {
        $org = $this->createOrganization(['plan' => 'trial']);
        $owner = $this->createUser($org, 'owner');

        // Trial plan has 5 seats; create 4 more active users (owner already 1)
        $this->createUser($org, 'employee', ['is_active' => true]);
        $this->createUser($org, 'employee', ['is_active' => true]);
        $this->createUser($org, 'employee', ['is_active' => true]);
        $this->createUser($org, 'employee', ['is_active' => true]);

        $this->actingAs($owner, 'sanctum');

        $response = $this->postJson('/api/v1/invitations', [
            'email' => 'blocked@example.com',
            'role' => 'employee',
        ]);

        $response->assertStatus(402)
            ->assertJsonFragment(['message' => 'Seat limit reached. Please upgrade your plan.']);
    }

    public function test_cannot_accept_when_seat_limit_reached(): void
    {
        $org = Organization::factory()->create(['plan' => 'trial']);
        $owner = User::factory()->create(['organization_id' => $org->id, 'role' => 'owner', 'is_active' => true]);

        // Fill remaining seats to reach limit (trial=5, owner already 1)
        User::factory()->create(['organization_id' => $org->id, 'role' => 'employee', 'is_active' => true]);
        User::factory()->create(['organization_id' => $org->id, 'role' => 'employee', 'is_active' => true]);
        User::factory()->create(['organization_id' => $org->id, 'role' => 'employee', 'is_active' => true]);
        User::factory()->create(['organization_id' => $org->id, 'role' => 'employee', 'is_active' => true]);

        $invitation = Invitation::create([
            'organization_id' => $org->id,
            'email' => 'limitaccept@example.com',
            'role' => 'employee',
            'token' => Str::random(64),
            'expires_at' => now()->addDays(7),
            'created_by' => $owner->id,
        ]);

        $response = $this->postJson('/api/v1/invitations/accept', [
            'token' => $invitation->token,
            'name' => 'Blocked User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertStatus(402)
            ->assertJsonFragment(['message' => 'Seat limit reached. Please upgrade your plan.']);
    }

    public function test_owner_can_resend_invitation(): void
    {
        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');
        $this->actingAs($owner, 'sanctum');

        $invitation = Invitation::factory()->create([
            'organization_id' => $org->id,
            'expires_at' => now()->addHours(1),
            'created_by' => $owner->id,
        ]);

        $res = $this->postJson("/api/v1/invitations/{$invitation->id}/resend");
        $res->assertOk();

        $invitation->refresh();
        $this->assertTrue($invitation->expires_at->isFuture());
    }

    public function test_owner_can_revoke_invitation(): void
    {
        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');
        $this->actingAs($owner, 'sanctum');

        $invitation = Invitation::factory()->create([
            'organization_id' => $org->id,
            'created_by' => $owner->id,
        ]);

        $res = $this->deleteJson("/api/v1/invitations/{$invitation->id}");
        $res->assertOk();

        $this->assertDatabaseMissing('invitations', ['id' => $invitation->id]);
    }

    /** AUTH-10: Accept invitation */
    public function test_user_can_accept_valid_invitation(): void
    {
        $org = Organization::factory()->create();
        $owner = User::factory()->create(['organization_id' => $org->id, 'role' => 'owner']);

        $invitation = Invitation::create([
            'organization_id' => $org->id,
            'email' => 'newuser@example.com',
            'role' => 'employee',
            'token' => Str::random(64),
            'expires_at' => now()->addDays(7),
            'created_by' => $owner->id,
        ]);

        $response = $this->postJson('/api/v1/invitations/accept', [
            'token' => $invitation->token,
            'name' => 'New User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure(['user', 'access_token', 'refresh_token']);

        $this->assertDatabaseHas('users', [
            'email' => 'newuser@example.com',
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $invitation->refresh();
        $this->assertNotNull($invitation->accepted_at);
    }

    /** AUTH-10: Cannot accept expired invitation */
    public function test_cannot_accept_expired_invitation(): void
    {
        $org = Organization::factory()->create();
        $owner = User::factory()->create(['organization_id' => $org->id, 'role' => 'owner']);

        $invitation = Invitation::create([
            'organization_id' => $org->id,
            'email' => 'expired@example.com',
            'role' => 'employee',
            'token' => Str::random(64),
            'expires_at' => now()->subDay(),
            'created_by' => $owner->id,
        ]);

        $response = $this->postJson('/api/v1/invitations/accept', [
            'token' => $invitation->token,
            'name' => 'User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertStatus(410);
    }

    /** AUTH-10: Cannot accept with invalid token */
    public function test_cannot_accept_invalid_token(): void
    {
        $response = $this->postJson('/api/v1/invitations/accept', [
            'token' => 'invalid-token-that-does-not-exist',
            'name' => 'User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertStatus(404);
    }
}
