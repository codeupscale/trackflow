<?php

namespace Tests\Feature\Auth;

use App\Models\Organization;
use App\Models\User;
use Tests\TestCase;

class AuthFlowTest extends TestCase
{
    /** AUTH-04: Logout */
    public function test_authenticated_user_can_logout(): void
    {
        $user = $this->actingAsUser('owner');

        $response = $this->postJson('/api/v1/auth/logout');

        $response->assertOk()
            ->assertJson(['message' => 'Logged out successfully.']);
    }

    public function test_logout_requires_authentication(): void
    {
        $response = $this->postJson('/api/v1/auth/logout');
        $response->assertStatus(401);
    }

    /** AUTH-07: Get current user */
    public function test_me_returns_current_user(): void
    {
        $user = $this->actingAsUser('owner');

        $response = $this->getJson('/api/v1/auth/me');

        $response->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('user.role', 'owner')
            ->assertJsonStructure([
                'user' => [
                    'id',
                    'organization_id',
                    'name',
                    'email',
                    'role',
                    'organization' => ['id', 'name', 'slug', 'plan'],
                ],
            ]);
    }

    public function test_me_requires_authentication(): void
    {
        $response = $this->getJson('/api/v1/auth/me');
        $response->assertStatus(401);
    }

    /** AUTH-03: Refresh token */
    public function test_refresh_requires_authentication(): void
    {
        $response = $this->postJson('/api/v1/auth/refresh');
        $response->assertStatus(401);
    }

    /** Cross-tenant isolation */
    public function test_user_cannot_see_other_org_data_via_me(): void
    {
        $org1 = Organization::factory()->create();
        $org2 = Organization::factory()->create();
        $user1 = User::factory()->create(['organization_id' => $org1->id, 'role' => 'owner']);

        $this->actingAs($user1, 'sanctum');

        $response = $this->getJson('/api/v1/auth/me');

        $response->assertOk();
        $this->assertEquals($org1->id, $response->json('user.organization_id'));
        $this->assertNotEquals($org2->id, $response->json('user.organization_id'));
    }
}
