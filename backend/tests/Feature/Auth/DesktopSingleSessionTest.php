<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Tests\TestCase;

class DesktopSingleSessionTest extends TestCase
{
    private const DESKTOP_HEADER = ['X-TrackFlow-Client' => 'desktop'];

    public function test_second_desktop_login_revokes_first_desktop_session(): void
    {
        $org = $this->createOrganization();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'desktop@example.com',
            'password' => 'password123',
            'role' => 'owner',
        ]);

        $firstDesktop = $this->postJson('/api/v1/auth/login', [
            'email' => 'desktop@example.com',
            'password' => 'password123',
        ], self::DESKTOP_HEADER)->assertOk();

        $firstAccess = $firstDesktop->json('access_token');
        $firstRefresh = $firstDesktop->json('refresh_token');

        $this->postJson('/api/v1/auth/login', [
            'email' => 'desktop@example.com',
            'password' => 'password123',
        ], self::DESKTOP_HEADER)->assertOk();

        $this->withHeader('Authorization', 'Bearer '.$firstAccess)
            ->getJson('/api/v1/auth/me')
            ->assertStatus(401);

        $this->withHeader('Authorization', 'Bearer '.$firstRefresh)
            ->withHeaders(self::DESKTOP_HEADER)
            ->postJson('/api/v1/auth/refresh')
            ->assertStatus(401);
    }

    public function test_desktop_login_does_not_revoke_web_session(): void
    {
        $org = $this->createOrganization();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'mixed@example.com',
            'password' => 'password123',
            'role' => 'owner',
        ]);

        $web = $this->postJson('/api/v1/auth/login', [
            'email' => 'mixed@example.com',
            'password' => 'password123',
        ])->assertOk();

        $webAccess = $web->json('access_token');

        $this->postJson('/api/v1/auth/login', [
            'email' => 'mixed@example.com',
            'password' => 'password123',
        ], self::DESKTOP_HEADER)->assertOk();

        $this->withHeader('Authorization', 'Bearer '.$webAccess)
            ->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('user.email', 'mixed@example.com');
    }

    public function test_web_login_does_not_revoke_active_desktop_session(): void
    {
        $org = $this->createOrganization();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'webfirst@example.com',
            'password' => 'password123',
            'role' => 'owner',
        ]);

        $desktop = $this->postJson('/api/v1/auth/login', [
            'email' => 'webfirst@example.com',
            'password' => 'password123',
        ], self::DESKTOP_HEADER)->assertOk();

        $desktopAccess = $desktop->json('access_token');

        $this->postJson('/api/v1/auth/login', [
            'email' => 'webfirst@example.com',
            'password' => 'password123',
        ])->assertOk();

        $this->withHeader('Authorization', 'Bearer '.$desktopAccess)
            ->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('user.email', 'webfirst@example.com');
    }
}
