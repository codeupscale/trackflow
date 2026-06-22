<?php

namespace Tests\Feature\Auth;

use App\Models\ActivityLog;
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

    public function test_second_desktop_login_terminates_previous_desktop_session(): void
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

        // Last-login-wins: the second desktop logs in successfully...
        $this->postJson('/api/v1/auth/login', [
            'email' => 'desktop@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders(self::DEVICE_B))->assertOk();

        // ...and the first desktop's session has been revoked (next request 401s).
        $this->withHeader('Authorization', 'Bearer '.$firstDesktop->json('access_token'))
            ->getJson('/api/v1/auth/me')
            ->assertUnauthorized();
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

    public function test_desktop_login_closes_open_timer_from_previous_session(): void
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

        // A timer left open by the previous (crashed / uninstalled) session.
        $entry = TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'started_at' => now()->subHour(),
            'ended_at' => null,
        ]);

        // New desktop login succeeds and reclaims the orphaned timer.
        $this->postJson('/api/v1/auth/login', [
            'email' => 'timer@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders(self::DEVICE_B))->assertOk();

        $entry->refresh();
        $this->assertNotNull($entry->ended_at, 'Orphaned timer should be closed on new desktop login.');
        // No heartbeats logged → entry ends at started_at; phantom tail is discarded.
        $this->assertSame(0, (int) $entry->duration_seconds);
    }

    public function test_open_timer_is_trimmed_to_last_heartbeat_discarding_phantom_time(): void
    {
        $org = $this->createOrganization();
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'phantom@example.com',
            'password' => 'password123',
            'role' => 'owner',
        ]);

        // Timer started 2h ago; the agent died after 30 min (last heartbeat then).
        $startedAt = now()->subHours(2);
        $lastHeartbeat = $startedAt->copy()->addMinutes(30);
        $entry = TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'started_at' => $startedAt,
            'ended_at' => null,
        ]);
        ActivityLog::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => $lastHeartbeat,
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'phantom@example.com',
            'password' => 'password123',
        ], $this->desktopHeaders(self::DEVICE_A))->assertOk();

        $entry->refresh();
        // Ends at last heartbeat (~30 min), NOT at login time (~2h). Phantom 90 min discarded.
        $this->assertNotNull($entry->ended_at);
        $this->assertEqualsWithDelta(1800, (int) $entry->duration_seconds, 5);
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
