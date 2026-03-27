<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPasswordResetTest extends TestCase
{
    public function test_owner_can_reset_team_member_password_with_provided_password(): void
    {
        $org = Organization::factory()->create();
        $actor = $this->actingAsUser('owner', $org);
        $target = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
            'password' => 'old-password-123',
        ]);

        $target->createToken('access_token');
        $this->assertGreaterThan(0, $target->tokens()->count());

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertOk()
            ->assertJson([
                'message' => 'Password reset successfully.',
                'user_id' => $target->id,
            ])
            ->assertJsonMissing(['generated_password']);

        $target->refresh();
        $this->assertTrue(Hash::check('new-password-123', $target->password));
        $this->assertSame(0, $target->tokens()->count());
    }

    public function test_admin_can_reset_team_member_password(): void
    {
        $org = Organization::factory()->create();
        $this->actingAsUser('admin', $org);
        $target = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertOk();
    }

    public function test_manager_can_reset_team_member_password(): void
    {
        $org = Organization::factory()->create();
        $this->actingAsUser('manager', $org);
        $target = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertOk();
    }

    public function test_employee_cannot_reset_other_users_password(): void
    {
        $org = Organization::factory()->create();
        $this->actingAsUser('employee', $org);
        $target = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertStatus(403);
    }

    public function test_cannot_reset_cross_org_user_password(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $this->actingAsUser('admin', $orgA);
        $target = User::factory()->create([
            'organization_id' => $orgB->id,
            'role' => 'employee',
        ]);

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertStatus(404);
    }

    public function test_reset_is_blocked_when_org_enforces_sso(): void
    {
        $org = Organization::factory()->create([
            'enforce_sso' => true,
            'sso_config' => ['provider' => 'saml'],
        ]);
        $this->actingAsUser('admin', $org);
        $target = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertStatus(422)
            ->assertJsonStructure(['message', 'errors' => ['password']]);
    }

    public function test_reset_is_blocked_for_sso_managed_user(): void
    {
        $org = Organization::factory()->create();
        $this->actingAsUser('admin', $org);
        $target = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
            'sso_provider' => 'google',
            'sso_provider_id' => 'abc123',
        ]);

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ]);

        $response->assertStatus(422)
            ->assertJsonStructure(['message', 'errors' => ['password']]);
    }

    public function test_generate_true_returns_generated_password_once_and_resets_password(): void
    {
        $org = Organization::factory()->create();
        $this->actingAsUser('admin', $org);
        $target = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $response = $this->postJson("/api/v1/users/{$target->id}/password-reset", [
            'generate' => true,
        ]);

        $response->assertOk()
            ->assertJsonStructure(['message', 'user_id', 'generated_password']);

        $generated = $response->json('generated_password');
        $this->assertIsString($generated);
        $this->assertGreaterThanOrEqual(8, strlen($generated));

        $target->refresh();
        $this->assertTrue(Hash::check($generated, $target->password));
    }
}

