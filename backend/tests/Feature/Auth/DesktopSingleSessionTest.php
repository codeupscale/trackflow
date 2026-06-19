<?php

namespace Tests\Feature\Auth;

use App\Models\TimeEntry;
use App\Models\User;
use Tests\TestCase;

class DesktopSingleSessionTest extends TestCase
{
    private const DEVICE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private const DEVICE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  /** @return array<string, string> */
    private function desktopHeaders(string $deviceId = self::DEVICE_A): array
    {
        return [
            'X-TrackFlow-Client' => 'desktop',
            'X-Device-Id' => $deviceId,
        ];
    }

    public function test_second_desktop_login_is_rejected_when_another_desktop_is_active(): void
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
        ], $this->desktopHeaders(self::DEVICE_A))->assertOk();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'desktop@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders(self::DEVICE_B))
            ->assertStatus(409)
            ->assertJsonFragment([
                'message' => 'This account is already logged in on another desktop computer. Log out there first.',
            ]);

        $this->withHeader('Authorization', 'Bearer '.$firstDesktop->json('access_token'))
            ->getJson('/api/v1/auth/me')
            ->assertOk();
    }

    public function test_same_desktop_device_can_relogin(): void
    {
        $org = $this->createOrganization();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'relogin@example.com',
            'password' => 'password123',
            'role' => 'owner',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'relogin@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders())->assertOk();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'relogin@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders())->assertOk();
    }

    public function test_desktop_login_blocked_while_timer_is_running_on_another_desktop(): void
    {
        $org = $this->createOrganization();
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'timer@example.com',
            'password' => 'password123',
            'role' => 'owner',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'timer@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders(self::DEVICE_A))->assertOk();

        TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'started_at' => now()->subHour(),
            'ended_at' => null,
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'timer@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders(self::DEVICE_B))
            ->assertStatus(409)
            ->assertJsonFragment([
                'message' => 'A timer is running on another desktop. Stop the timer and log out there before signing in here.',
            ]);
    }

    public function test_desktop_login_does_not_block_web_session(): void
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

        $this->postJson('/api/v1/auth/login', [
            'email' => 'mixed@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders())->assertOk();

        $this->withHeader('Authorization', 'Bearer '.$web->json('access_token'))
            ->getJson('/api/v1/auth/me')
            ->assertOk();
    }

    public function test_web_login_does_not_block_active_desktop_session(): void
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
        ], $this->desktopHeaders())->assertOk();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'webfirst@example.com',
            'password' => 'password123',
        ])->assertOk();

        $this->withHeader('Authorization', 'Bearer '.$desktop->json('access_token'))
            ->getJson('/api/v1/auth/me')
            ->assertOk();
    }

    public function test_desktop_login_requires_device_id_header(): void
    {
        $org = $this->createOrganization();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'nodevice@example.com',
            'password' => 'password123',
            'role' => 'owner',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'nodevice@example.com',
            'password' => 'password123',
        ], ['X-TrackFlow-Client' => 'desktop'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['device']);
    }
}
