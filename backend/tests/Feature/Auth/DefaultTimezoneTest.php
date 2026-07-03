<?php

namespace Tests\Feature\Auth;

use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Every user-creation path must persist a non-NULL users.timezone, resolved via
 * User::defaultTimezoneForOrg() with precedence: valid client tz -> org setting -> Asia/Karachi.
 */
class DefaultTimezoneTest extends TestCase
{
    // ---- Helper unit tests (also stand in for SAML JIT, which has no feature harness) ----

    public function test_helper_prefers_valid_client_provided_timezone(): void
    {
        $org = Organization::factory()->create(['settings' => ['timezone' => 'Europe/London']]);

        $this->assertSame(
            'America/New_York',
            User::defaultTimezoneForOrg($org, 'America/New_York')
        );
    }

    public function test_helper_ignores_invalid_client_timezone_and_falls_back_to_org(): void
    {
        $org = Organization::factory()->create(['settings' => ['timezone' => 'Europe/London']]);

        $this->assertSame(
            'Europe/London',
            User::defaultTimezoneForOrg($org, 'Not/ARealZone')
        );
    }

    public function test_helper_uses_org_setting_when_no_client_timezone(): void
    {
        $org = Organization::factory()->create(['settings' => ['timezone' => 'Asia/Tokyo']]);

        $this->assertSame('Asia/Tokyo', User::defaultTimezoneForOrg($org));
    }

    public function test_helper_defaults_to_asia_karachi_when_org_has_no_timezone_setting(): void
    {
        // Org settings intentionally omit the 'timezone' key.
        $org = Organization::factory()->create(['settings' => ['screenshot_interval' => 5]]);

        $this->assertSame('Asia/Karachi', User::defaultTimezoneForOrg($org));
    }

    public function test_helper_defaults_to_asia_karachi_when_no_org(): void
    {
        $this->assertSame('Asia/Karachi', User::defaultTimezoneForOrg(null));
        $this->assertSame('Asia/Karachi', User::defaultTimezoneForOrg(null, 'Not/AZone'));
    }

    // ---- Invitation acceptance ----

    public function test_invited_user_inherits_org_timezone_setting(): void
    {
        $org = Organization::factory()->create(['settings' => ['timezone' => 'America/New_York']]);
        $owner = User::factory()->create(['organization_id' => $org->id, 'role' => 'owner']);

        $invitation = Invitation::create([
            'organization_id' => $org->id,
            'email' => 'invitee@example.com',
            'role' => 'employee',
            'token' => Str::random(64),
            'expires_at' => now()->addDays(7),
            'created_by' => $owner->id,
        ]);

        $response = $this->postJson('/api/v1/invitations/accept', [
            'token' => $invitation->token,
            'name' => 'Invitee',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('users', [
            'email' => 'invitee@example.com',
            'organization_id' => $org->id,
            'timezone' => 'America/New_York',
        ]);
    }

    public function test_invited_user_defaults_to_asia_karachi_when_org_has_no_timezone_setting(): void
    {
        $org = Organization::factory()->create(['settings' => ['screenshot_interval' => 5]]);
        $owner = User::factory()->create(['organization_id' => $org->id, 'role' => 'owner']);

        $invitation = Invitation::create([
            'organization_id' => $org->id,
            'email' => 'invitee2@example.com',
            'role' => 'employee',
            'token' => Str::random(64),
            'expires_at' => now()->addDays(7),
            'created_by' => $owner->id,
        ]);

        $response = $this->postJson('/api/v1/invitations/accept', [
            'token' => $invitation->token,
            'name' => 'Invitee Two',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('users', [
            'email' => 'invitee2@example.com',
            'organization_id' => $org->id,
            'timezone' => 'Asia/Karachi',
        ]);
    }

    // ---- Direct registration ----

    public function test_registration_uses_client_provided_timezone(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'Reg User',
            'email' => 'reg@example.com',
            'password' => 'Password123',
            'password_confirmation' => 'Password123',
            'company_name' => 'Reg Co',
            'timezone' => 'America/New_York',
        ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('users', [
            'email' => 'reg@example.com',
            'timezone' => 'America/New_York',
        ]);
    }

    public function test_registration_defaults_to_asia_karachi_when_no_timezone(): void
    {
        $response = $this->postJson('/api/v1/auth/register', [
            'name' => 'Reg User2',
            'email' => 'reg2@example.com',
            'password' => 'Password123',
            'password_confirmation' => 'Password123',
            'company_name' => 'Reg Co Two',
        ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('users', [
            'email' => 'reg2@example.com',
            'timezone' => 'Asia/Karachi',
        ]);
    }

    // ---- Google signup ----

    public function test_google_signup_new_personal_org_defaults_to_asia_karachi(): void
    {
        $this->fakeGoogleToken('gnew@example.com', 'Google New', 'google-sub-1');

        $response = $this->postJson('/api/v1/auth/google', ['id_token' => 'fake-token']);

        $response->assertSuccessful();

        $this->assertDatabaseHas('users', [
            'email' => 'gnew@example.com',
            'sso_provider' => 'google',
            'timezone' => 'Asia/Karachi',
        ]);
    }

    public function test_google_signup_with_pending_invitation_inherits_org_timezone(): void
    {
        // Invited org carries a custom timezone; personal org falls back to default.
        $org = Organization::factory()->create(['settings' => ['timezone' => 'Europe/London']]);
        $owner = User::factory()->create(['organization_id' => $org->id, 'role' => 'owner']);

        Invitation::create([
            'organization_id' => $org->id,
            'email' => 'ginvite@example.com',
            'role' => 'employee',
            'token' => Str::random(64),
            'expires_at' => now()->addDays(7),
            'created_by' => $owner->id,
        ]);

        $this->fakeGoogleToken('ginvite@example.com', 'Google Invitee', 'google-sub-2');

        $response = $this->postJson('/api/v1/auth/google', ['id_token' => 'fake-token']);

        $response->assertSuccessful();

        // Invited-org user inherits the invited org's timezone (AuthController line ~435).
        $this->assertDatabaseHas('users', [
            'email' => 'ginvite@example.com',
            'organization_id' => $org->id,
            'timezone' => 'Europe/London',
        ]);

        // Auto-created personal org owner gets the platform default (line ~465).
        $personal = User::where('email', 'ginvite@example.com')
            ->where('organization_id', '!=', $org->id)
            ->first();
        $this->assertNotNull($personal);
        $this->assertSame('Asia/Karachi', $personal->timezone);
    }

    private function fakeGoogleToken(string $email, string $name, string $sub): void
    {
        config(['services.google.client_id' => 'test-web-client-id']);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'aud' => 'test-web-client-id',
                'email' => $email,
                'sub' => $sub,
                'name' => $name,
            ], 200),
        ]);
    }
}
