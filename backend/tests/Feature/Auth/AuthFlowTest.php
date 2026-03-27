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

    /** AUTH-08: Change password */
    public function test_authenticated_user_can_change_password(): void
    {
        $user = $this->actingAsUser('owner');

        $response = $this->postJson('/api/v1/auth/change-password', [
            'current_password' => 'password',
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertOk()
            ->assertJson([
                'message' => 'Password updated successfully.',
                'token_type' => 'Bearer',
            ])
            ->assertJsonStructure(['access_token', 'refresh_token']);

        $user->refresh();
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('new-password-123', $user->password));

        // Tokens should be rotated (access + refresh)
        $this->assertCount(2, $user->tokens()->get());
    }

    public function test_change_password_requires_correct_current_password(): void
    {
        $this->actingAsUser('owner');

        $response = $this->postJson('/api/v1/auth/change-password', [
            'current_password' => 'wrong-password',
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertStatus(422)
            ->assertJsonStructure(['message', 'errors' => ['current_password']]);
    }

    public function test_change_password_requires_authentication(): void
    {
        $response = $this->postJson('/api/v1/auth/change-password', [
            'current_password' => 'password',
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertStatus(401);
    }

    public function test_change_password_is_blocked_when_sso_is_enforced(): void
    {
        $org = Organization::factory()->create([
            'enforce_sso' => true,
            'sso_config' => ['provider' => 'saml'],
        ]);
        $this->actingAsUser('owner', $org);

        $response = $this->postJson('/api/v1/auth/change-password', [
            'current_password' => 'password',
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertStatus(422)
            ->assertJsonStructure(['message', 'errors' => ['password']]);
    }
}
