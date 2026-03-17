<?php

namespace Tests\Feature\Auth;

use App\Models\Organization;
use App\Models\User;
use Tests\TestCase;

class RegisterTest extends TestCase
{
    public function test_user_can_register_with_valid_data(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'John Doe',
            'email' => 'john@example.com',
            'password' => 'Password123',
            'password_confirmation' => 'Password123',
            'company_name' => 'Acme Corp',
            'timezone' => 'America/New_York',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'user' => ['id', 'name', 'email', 'role', 'organization_id', 'organization'],
                'access_token',
                'refresh_token',
                'token_type',
            ]);

        $this->assertDatabaseHas('organizations', ['name' => 'Acme Corp', 'plan' => 'trial']);
        $this->assertDatabaseHas('users', ['email' => 'john@example.com', 'role' => 'owner']);

        $this->assertEquals('owner', $response->json('user.role'));
        $this->assertNotNull($response->json('user.organization.trial_ends_at'));
    }

    public function test_registration_fails_with_missing_fields(): void
    {
        $response = $this->postJson('/api/v1/auth/register', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'email', 'password', 'company_name']);
    }

    public function test_registration_fails_with_short_password(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'John',
            'email' => 'john@example.com',
            'password' => 'short',
            'password_confirmation' => 'short',
            'company_name' => 'Acme',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['password']);
    }

    public function test_registration_creates_org_with_14_day_trial(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'name' => 'Jane',
            'email' => 'jane@example.com',
            'password' => 'Password123',
            'password_confirmation' => 'Password123',
            'company_name' => 'Test Co',
        ]);

        $org = Organization::first();
        $this->assertEquals('trial', $org->plan);
        $this->assertTrue($org->trial_ends_at->isFuture());
        $this->assertGreaterThanOrEqual(13, (int) abs($org->trial_ends_at->diffInDays(now())));
    }
}
