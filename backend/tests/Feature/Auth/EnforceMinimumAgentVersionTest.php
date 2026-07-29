<?php

namespace Tests\Feature\Auth;

use App\Models\Organization;
use App\Models\User;
use Tests\TestCase;

/**
 * Server-side minimum desktop agent version gate (EnforceMinimumAgentVersion).
 *
 * Disabled by default (TIMER_MIN_AGENT_VERSION empty). When set, only requests
 * with X-TrackFlow-Client: desktop are checked; web login is unaffected.
 */
class EnforceMinimumAgentVersionTest extends TestCase
{
    /**
     * A desktop login must also carry the device identifier that the single-desktop-session
     * feature requires (AuthTokenService::requireDeviceIdFromRequest — 32-64 hex chars, no
     * dashes). Only tests that expect the login to SUCCEED need it: a stale agent version is
     * rejected by the EnforceMinimumAgentVersion middleware with 426 before the controller
     * ever reaches the device check.
     */
    private const DEVICE_ID = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    protected function tearDown(): void
    {
        config(['timer.min_agent_version' => '']);
        parent::tearDown();
    }

    public function test_web_login_unaffected_when_minimum_is_set(): void
    {
        config(['timer.min_agent_version' => '1.0.44']);

        $org = Organization::factory()->create();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'john@example.com',
            'password' => 'password123',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'john@example.com',
            'password' => 'password123',
        ])->assertOk();
    }

    public function test_old_desktop_login_rejected_with_426(): void
    {
        config(['timer.min_agent_version' => '1.0.44']);

        $org = Organization::factory()->create();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'john@example.com',
            'password' => 'password123',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'john@example.com',
            'password' => 'password123',
        ], [
            'X-TrackFlow-Client' => 'desktop',
            'X-Agent-Version' => '1.0.43',
        ])
            ->assertStatus(426)
            ->assertJsonPath('code', 'AGENT_UPGRADE_REQUIRED')
            ->assertJsonPath('min_version', '1.0.44');
    }

    public function test_current_desktop_login_allowed(): void
    {
        config(['timer.min_agent_version' => '1.0.44']);

        $org = Organization::factory()->create();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'john@example.com',
            'password' => 'password123',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'john@example.com',
            'password' => 'password123',
        ], [
            'X-TrackFlow-Client' => 'desktop',
            'X-Agent-Version' => '1.0.44',
            'X-Device-Id' => self::DEVICE_ID,
        ])->assertOk();
    }

    public function test_desktop_without_version_header_is_rejected(): void
    {
        config(['timer.min_agent_version' => '1.0.44']);

        $org = Organization::factory()->create();
        User::factory()->create([
            'organization_id' => $org->id,
            'email' => 'john@example.com',
            'password' => 'password123',
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'john@example.com',
            'password' => 'password123',
        ], [
            'X-TrackFlow-Client' => 'desktop',
        ])
            ->assertStatus(426)
            ->assertJsonPath('code', 'AGENT_UPGRADE_REQUIRED');
    }

    public function test_old_desktop_cannot_start_timer(): void
    {
        config(['timer.min_agent_version' => '1.0.44']);

        $org = Organization::factory()->create();
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);
        $this->actingAs($user, 'sanctum');

        $this->postJson('/api/v1/timer/start', [], [
            'X-TrackFlow-Client' => 'desktop',
            'X-Agent-Version' => '1.0.40',
        ])
            ->assertStatus(426)
            ->assertJsonPath('code', 'AGENT_UPGRADE_REQUIRED');
    }
}
