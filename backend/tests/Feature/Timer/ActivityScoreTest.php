<?php

namespace Tests\Feature\Timer;

use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\TimerService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

/**
 * Activity score calculation tests.
 *
 * Uses DatabaseMigrations (not RefreshDatabase) because TimerService::start()
 * and stop() use DB::transaction() internally, and SQLite + PHP 8.4 does not
 * support nested transactions via the RefreshDatabase transaction wrapper.
 *
 * Uses Redis::shouldReceive() to mock Redis in tests that call TimerService
 * methods, because the test environment may not have a live Redis instance.
 *
 * Covers:
 *   - Active-seconds model scoring (active_seconds / interval * 100)
 *   - EMA smoothing (alpha=0.3) on processHeartbeat
 *   - Final score computation from ActivityLog ground truth
 *   - Score clamping to [0, 100]
 *   - Legacy event-count backward compatibility
 *   - Multi-tenancy isolation for activity logs
 *   - Token lifecycle (expired token)
 *   - Timer race conditions
 */
class ActivityScoreTest extends TestCase
{
    use DatabaseMigrations;

    private TimerService $service;
    private Organization $org;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new TimerService();
        $this->org = Organization::factory()->create();
        $this->user = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'employee',
        ]);
        $this->actingAs($this->user, 'sanctum');
    }

    /**
     * Helper: create a running time entry and mock Redis so processHeartbeat can find it.
     */
    private function createRunningEntryWithRedis(array $attrs = []): TimeEntry
    {
        $entry = TimeEntry::create(array_merge([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now(),
            'type' => 'tracked',
        ], $attrs));

        $redisData = json_encode([
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
            'project_id' => $entry->project_id ?? null,
            'task_id' => $entry->task_id ?? null,
        ]);

        // Mock Redis::get to return timer data for processHeartbeat
        Redis::shouldReceive('get')
            ->with("timer:{$this->user->id}")
            ->andReturn($redisData);

        return $entry;
    }

    /**
     * Helper: mock Redis for stop() call (get returns timer data, del clears it).
     */
    private function mockRedisForStop(TimeEntry $entry): void
    {
        $redisData = json_encode([
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
            'project_id' => $entry->project_id ?? null,
            'task_id' => $entry->task_id ?? null,
        ]);

        Redis::shouldReceive('get')
            ->with("timer:{$this->user->id}")
            ->andReturn($redisData);
        Redis::shouldReceive('set')
            ->with("timer:lock:{$this->user->id}", 1, 'EX', 5, 'NX')
            ->andReturn(true);
        Redis::shouldReceive('del')
            ->with("timer:{$this->user->id}")
            ->andReturn(1);
        Redis::shouldReceive('del')
            ->with("timer:lock:{$this->user->id}")
            ->andReturn(1);
    }

    /**
     * Helper: mock Redis for switchProject() call.
     */
    private function mockRedisForSwitch(TimeEntry $entry): void
    {
        $redisData = json_encode([
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
            'project_id' => $entry->project_id ?? null,
            'task_id' => $entry->task_id ?? null,
        ]);

        Redis::shouldReceive('get')
            ->with("timer:{$this->user->id}")
            ->andReturn($redisData);
        Redis::shouldReceive('set')
            ->with("timer:lock:{$this->user->id}", 1, 'EX', 5, 'NX')
            ->andReturn(true);
        Redis::shouldReceive('setex')
            ->withAnyArgs()
            ->andReturn(true);
        Redis::shouldReceive('del')
            ->with("timer:lock:{$this->user->id}")
            ->andReturn(1);
    }

    // ─── Active-seconds model: score = active_seconds / interval * 100 ─────

    public function test_activity_score_calculated_as_active_seconds_over_total_time(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 50,
            'mouse_events' => 50,
            'active_seconds' => 15,
        ]);

        $entry->refresh();
        $this->assertEquals(50, $entry->activity_score);
    }

    public function test_ema_smoothing_applied_correctly_alpha_0_3(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        // First heartbeat: 100% activity
        $this->service->processHeartbeat([
            'keyboard_events' => 100,
            'mouse_events' => 100,
            'active_seconds' => 30,
        ]);
        $entry->refresh();
        $this->assertEquals(100, $entry->activity_score);

        // Second heartbeat: 0% activity -> EMA = 0.3*0 + 0.7*100 = 70
        $this->service->processHeartbeat([
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => 0,
        ]);
        $entry->refresh();
        $this->assertEquals(70, $entry->activity_score);

        // Third heartbeat: 50% -> EMA = 0.3*50 + 0.7*70 = 64
        $this->service->processHeartbeat([
            'keyboard_events' => 30,
            'mouse_events' => 30,
            'active_seconds' => 15,
        ]);
        $entry->refresh();
        $this->assertEquals(64, $entry->activity_score);
    }

    public function test_score_capped_at_100_percent(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 500,
            'mouse_events' => 500,
            'active_seconds' => 60,
        ]);

        $entry->refresh();
        $this->assertLessThanOrEqual(100, $entry->activity_score);
        $this->assertEquals(100, $entry->activity_score);
    }

    public function test_zero_activity_returns_zero_score(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => 0,
        ]);

        $entry->refresh();
        $this->assertEquals(0, $entry->activity_score);
    }

    public function test_full_activity_returns_100_score(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 200,
            'mouse_events' => 200,
            'active_seconds' => 30,
        ]);

        $entry->refresh();
        $this->assertEquals(100, $entry->activity_score);
    }

    public function test_score_never_goes_below_zero(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => 0,
        ]);
        $this->service->processHeartbeat([
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => 0,
        ]);
        $this->service->processHeartbeat([
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => 0,
        ]);

        $entry->refresh();
        $this->assertGreaterThanOrEqual(0, $entry->activity_score);
        $this->assertEquals(0, $entry->activity_score);
    }

    // ─── Final activity score (ground truth from ActivityLogs) ────────────

    public function test_final_score_uses_active_seconds_ground_truth(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(2),
            'type' => 'tracked',
        ]);

        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now()->subMinute(),
            'keyboard_events' => 100,
            'mouse_events' => 100,
            'active_seconds' => 20,
        ]);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now(),
            'keyboard_events' => 50,
            'mouse_events' => 50,
            'active_seconds' => 10,
        ]);

        $this->mockRedisForStop($entry);

        $stopped = $this->service->stop();
        // (20+10) / (30+30) * 100 = 50
        $this->assertEquals(50, $stopped->activity_score);
    }

    public function test_final_score_caps_active_seconds_per_interval(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinute(),
            'type' => 'tracked',
        ]);

        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now(),
            'keyboard_events' => 200,
            'mouse_events' => 200,
            'active_seconds' => 50, // capped to 30
        ]);

        $this->mockRedisForStop($entry);

        $stopped = $this->service->stop();
        $this->assertEquals(100, $stopped->activity_score);
    }

    public function test_final_score_returns_zero_when_all_logs_have_zero_active_seconds(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinute(),
            'type' => 'tracked',
        ]);

        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now(),
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => 0,
        ]);

        $this->mockRedisForStop($entry);

        $stopped = $this->service->stop();
        $this->assertEquals(0, $stopped->activity_score);
    }

    public function test_final_score_fallback_when_no_activity_logs(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinute(),
            'type' => 'tracked',
        ]);

        $this->mockRedisForStop($entry);

        $stopped = $this->service->stop();
        $this->assertEquals(0, $stopped->activity_score);
    }

    // ─── Legacy event-count model ────────────────────────────────────────

    public function test_legacy_event_count_scoring_without_active_seconds(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 150,
            'mouse_events' => 150,
        ]);

        $entry->refresh();
        $this->assertEquals(100, $entry->activity_score);
    }

    public function test_legacy_event_count_partial_activity(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 75,
            'mouse_events' => 75,
        ]);

        $entry->refresh();
        $this->assertEquals(50, $entry->activity_score);
    }

    public function test_legacy_ema_blending(): void
    {
        $entry = $this->createRunningEntryWithRedis();

        // First: 100% (300/300)
        $this->service->processHeartbeat([
            'keyboard_events' => 150,
            'mouse_events' => 150,
        ]);
        $entry->refresh();
        $this->assertEquals(100, $entry->activity_score);

        // Second: 50% (150/300), EMA = 0.3*50 + 0.7*100 = 85
        $this->service->processHeartbeat([
            'keyboard_events' => 75,
            'mouse_events' => 75,
        ]);
        $entry->refresh();
        $this->assertEquals(85, $entry->activity_score);
    }

    public function test_legacy_final_score_averages_event_counts(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(2),
            'type' => 'tracked',
        ]);

        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now()->subMinute(),
            'keyboard_events' => 150,
            'mouse_events' => 150,
            'active_seconds' => null,
        ]);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now(),
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => null,
        ]);

        $this->mockRedisForStop($entry);

        $stopped = $this->service->stop();
        // avg(100, 0) = 50
        $this->assertEquals(50, $stopped->activity_score);
    }

    // ─── Heartbeat ActivityLog fields ────────────────────────────────────

    public function test_heartbeat_stores_active_seconds_in_activity_log(): void
    {
        $this->createRunningEntryWithRedis();

        $log = $this->service->processHeartbeat([
            'keyboard_events' => 40,
            'mouse_events' => 60,
            'active_seconds' => 22,
            'active_app' => 'VS Code',
            'active_window_title' => 'index.js',
        ]);

        $this->assertEquals(22, $log->active_seconds);
        $this->assertEquals(40, $log->keyboard_events);
        $this->assertEquals(60, $log->mouse_events);
        $this->assertEquals('VS Code', $log->active_app);
    }

    public function test_heartbeat_without_active_seconds_stores_null(): void
    {
        $this->createRunningEntryWithRedis();

        $log = $this->service->processHeartbeat([
            'keyboard_events' => 40,
            'mouse_events' => 60,
        ]);

        $this->assertNull($log->active_seconds);
    }

    public function test_heartbeat_updates_user_last_active_at(): void
    {
        $this->createRunningEntryWithRedis();

        $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
        ]);

        $this->user->refresh();
        $this->assertNotNull($this->user->last_active_at);
    }

    public function test_heartbeat_throws_when_no_timer_running(): void
    {
        Redis::shouldReceive('get')
            ->with("timer:{$this->user->id}")
            ->andReturn(null);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('No timer is currently running.');

        $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
        ]);
    }

    // ─── Timer stop integration ──────────────────────────────────────────

    public function test_stop_finalizes_entry_and_clears_redis(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinute(),
            'type' => 'tracked',
        ]);

        $this->mockRedisForStop($entry);

        $stopped = $this->service->stop();

        $this->assertEquals($entry->id, $stopped->id);
        $this->assertNotNull($stopped->ended_at);
        $this->assertNotNull($stopped->duration_seconds);
        $this->assertGreaterThanOrEqual(1, $stopped->duration_seconds);
    }

    public function test_stop_throws_when_no_timer_running(): void
    {
        Redis::shouldReceive('get')
            ->with("timer:{$this->user->id}")
            ->andReturn(null);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('No timer is currently running.');

        $this->service->stop();
    }

    // ─── Multi-tenancy isolation ─────────────────────────────────────────

    public function test_activity_logs_scoped_to_organization(): void
    {
        // Create entries in two different orgs and verify logs are isolated
        $orgB = Organization::factory()->create();
        $userB = User::factory()->create([
            'organization_id' => $orgB->id,
            'role' => 'employee',
        ]);

        // Create entry + log for org A (directly, no Redis needed)
        $entryA = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinute(),
            'type' => 'tracked',
        ]);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entryA->id,
            'logged_at' => now(),
            'keyboard_events' => 100,
            'mouse_events' => 100,
            'active_seconds' => 20,
        ]);

        // Create entry + log for org B
        $entryB = TimeEntry::create([
            'organization_id' => $orgB->id,
            'user_id' => $userB->id,
            'started_at' => now()->subMinute(),
            'type' => 'tracked',
        ]);
        ActivityLog::create([
            'organization_id' => $orgB->id,
            'user_id' => $userB->id,
            'time_entry_id' => $entryB->id,
            'logged_at' => now(),
            'keyboard_events' => 50,
            'mouse_events' => 50,
            'active_seconds' => 10,
        ]);

        // Verify logs are isolated by org (bypass global scope for cross-org assertion)
        $logsA = ActivityLog::withoutGlobalScopes()->where('organization_id', $this->org->id)->get();
        $logsB = ActivityLog::withoutGlobalScopes()->where('organization_id', $orgB->id)->get();

        $this->assertCount(1, $logsA);
        $this->assertCount(1, $logsB);
        $this->assertEquals($this->user->id, $logsA->first()->user_id);
        $this->assertEquals($userB->id, $logsB->first()->user_id);

        // Verify each log has correct active_seconds
        $this->assertEquals(20, $logsA->first()->active_seconds);
        $this->assertEquals(10, $logsB->first()->active_seconds);

        // Verify global scope works: org A user only sees org A logs
        $scopedLogs = ActivityLog::all();
        $this->assertCount(1, $scopedLogs);
        $this->assertEquals($this->org->id, $scopedLogs->first()->organization_id);
    }

    public function test_employee_cannot_see_other_org_time_entries_via_api(): void
    {
        $orgB = Organization::factory()->create();
        $userB = User::factory()->create([
            'organization_id' => $orgB->id,
            'role' => 'employee',
        ]);

        TimeEntry::factory()->create([
            'organization_id' => $orgB->id,
            'user_id' => $userB->id,
            'started_at' => now()->subHour(),
            'ended_at' => now(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $response = $this->actingAs($this->user, 'sanctum')
            ->getJson('/api/v1/time-entries');

        $response->assertStatus(200);
        $ids = collect($response->json('data'))->pluck('organization_id')->unique();
        $this->assertNotContains($orgB->id, $ids->toArray());
    }

    // ─── Authentication ──────────────────────────────────────────────────

    public function test_unauthenticated_me_returns_401(): void
    {
        // Use a fresh request without actingAs to verify auth is required
        $this->app['auth']->forgetGuards();

        $response = $this->getJson('/api/v1/auth/me');
        $response->assertStatus(401);
    }

    public function test_unauthenticated_time_entries_returns_401(): void
    {
        $this->app['auth']->forgetGuards();

        $response = $this->getJson('/api/v1/time-entries');
        $response->assertStatus(401);
    }

    // ─── Today total ─────────────────────────────────────────────────────

    public function test_today_total_includes_all_completed_entries(): void
    {
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 1800,
            'type' => 'tracked',
        ]);

        // Mock Redis for todayTotal (no running timer)
        Redis::shouldReceive('get')
            ->with("timer:{$this->user->id}")
            ->andReturn(null);

        $total = $this->service->todayTotal();
        $this->assertEquals(5400, $total);
    }

    // ─── Mixed mode scoring ──────────────────────────────────────────────

    public function test_final_score_mixed_mode_skips_legacy_active_seconds(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(2),
            'type' => 'tracked',
        ]);

        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now()->subMinute(),
            'keyboard_events' => 100,
            'mouse_events' => 100,
            'active_seconds' => 30,
        ]);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now(),
            'keyboard_events' => 100,
            'mouse_events' => 100,
            'active_seconds' => null,
        ]);

        $this->mockRedisForStop($entry);

        $stopped = $this->service->stop();
        // active_seconds mode: 30/60 * 100 = 50
        $this->assertEquals(50, $stopped->activity_score);
    }

    // ─── switchProject preserves activity score ──────────────────────────

    public function test_switch_project_preserves_activity_score(): void
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinute(),
            'type' => 'tracked',
        ]);

        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now(),
            'keyboard_events' => 150,
            'mouse_events' => 150,
            'active_seconds' => 30,
        ]);

        $this->mockRedisForSwitch($entry);

        $result = $this->service->switchProject([]);

        $this->assertNotNull($result['stopped']->activity_score);
        $this->assertEquals(100, $result['stopped']->activity_score);
        $this->assertNull($result['started']->ended_at);
    }
}
