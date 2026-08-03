<?php

namespace Tests\Feature\Timer;

use App\Console\Commands\CleanupStaleEntries;
use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\TimerService;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

/**
 * Regression tests for the offline timer/idle correctness fixes:
 *   B1 — preserve up to ~4h of offline work (cleanup threshold + extend-on-late-stop).
 *   B2 — heartbeat on a CLOSED entry is rejected (no post-finalization mutation);
 *        client-supplied capture timestamp is honored.
 *   B3 — idle timestamps are skew-bounded; the new post-idle entry never anchors a
 *        past-to-now dead gap.
 *   B4 — idle report on an already-closed session is an idempotent no-op.
 *
 * Uses the REAL Redis + the REAL one-open-timer unique index, exercising the actual
 * desktop reconcile paths.
 */
class TimerOfflineCorrectnessTest extends TestCase
{
    private TimerService $service;
    private Organization $org;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new TimerService();
        $this->org = $this->createOrganization();
        $this->user = $this->createUser($this->org, 'employee');
        $this->actingAs($this->user, 'sanctum');
        Redis::flushdb();
    }

    protected function tearDown(): void
    {
        Redis::flushdb();
        parent::tearDown();
    }

    /**
     * Open a live session directly. These tests use it as a FIXTURE for the heartbeat
     * assertions; TimerService::start() is gone (the desktop agent owns session creation
     * and pushes via TimeEntrySyncService), so this builds the same end state: an open
     * entry plus the Redis timer key processHeartbeat() resolves against.
     */
    private function openSession(array $attributes = []): TimeEntry
    {
        $entry = TimeEntry::create(array_merge([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now(),
            'type' => 'tracked',
        ], $attributes));

        Redis::setex("timer:{$this->user->id}", 2592000, json_encode([
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
            'project_id' => $entry->project_id,
            'task_id' => $entry->task_id,
            'state' => 'running',
        ]));

        return $entry;
    }

    // ─── B1: the abandoned-entry window (timer.abandoned_after_minutes, 60) ──
    //
    // Owner decision (2026-08-03): an agent that has gone silent for an hour is
    // treated as never coming back and its entry is closed AT ITS LAST HEARTBEAT.
    // What makes a window this tight safe for a merely OFFLINE user is the liveness
    // rule — the most recent of the last heartbeat and `client_synced_at`, the latter
    // stamped on every push of the live session, including one carrying no change.

    public function test_entry_with_a_recent_heartbeat_is_left_alone(): void
    {
        config(['timer.abandoned_after_minutes' => 60]);

        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(3),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now()->subMinutes(30),
            'keyboard_events' => 5,
            'mouse_events' => 5,
        ]);

        $this->artisan('timer:cleanup-stale')->assertExitCode(0);

        $this->assertNull($entry->fresh()->ended_at, 'A heartbeat inside the window means the agent is alive.');
    }

    public function test_an_offline_agent_that_still_syncs_is_never_treated_as_abandoned(): void
    {
        config(['timer.abandoned_after_minutes' => 60]);

        // Heartbeats are queued while offline and arrive in a burst much later, so the
        // last SERVER-received heartbeat is 3h old — but the agent pushed its session
        // 5 minutes ago, which proves it is alive. Closing here would truncate work the
        // user is doing right now.
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(4),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now()->subHours(3),
            'keyboard_events' => 1,
            'mouse_events' => 1,
        ]);
        TimeEntry::withoutGlobalScopes()->where('id', $entry->id)
            ->update(['client_synced_at' => now()->subMinutes(5)]);

        $this->artisan('timer:cleanup-stale')->assertExitCode(0);

        $this->assertNull($entry->fresh()->ended_at);
    }

    public function test_abandoned_entry_is_closed_at_its_last_heartbeat_never_at_now(): void
    {
        config(['timer.abandoned_after_minutes' => 60]);

        $started = now()->subHours(10);
        $lastHeartbeat = now()->subHours(5);

        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => $started,
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => $lastHeartbeat,
            'keyboard_events' => 1,
            'mouse_events' => 1,
        ]);

        $this->artisan('timer:cleanup-stale')->assertExitCode(0);

        $fresh = $entry->fresh();
        $this->assertNotNull($fresh->ended_at);
        // The five dead hours after the last heartbeat are discarded, not billed.
        $this->assertEqualsWithDelta($lastHeartbeat->timestamp, $fresh->ended_at->timestamp, 2);
        $this->assertEqualsWithDelta(
            $started->diffInSeconds($lastHeartbeat),
            $fresh->duration_seconds,
            2
        );
    }

    public function test_an_entry_with_no_heartbeat_at_all_closes_at_its_own_start(): void
    {
        config(['timer.abandoned_after_minutes' => 60]);

        // The agent opened a session, pushed it once, and was never seen again. There is
        // no evidence of WORK, so a zero-length close is the only honest outcome.
        $started = now()->subHours(9);
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => $started,
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);

        $this->artisan('timer:cleanup-stale')->assertExitCode(0);

        $fresh = $entry->fresh();
        $this->assertNotNull($fresh->ended_at);
        $this->assertEqualsWithDelta($started->timestamp, $fresh->ended_at->timestamp, 2);
        $this->assertSame(0, (int) $fresh->duration_seconds);
    }

    public function test_the_close_is_provisional_a_returning_agent_still_wins(): void
    {
        config(['timer.abandoned_after_minutes' => 60]);

        // `client_revision` must be left untouched, or the agent's next push would be
        // dismissed as a replay and the server's guess would become permanent.
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(8),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        TimeEntry::withoutGlobalScopes()->where('id', $entry->id)
            ->update(['client_revision' => 3, 'idempotency_key' => (string) \Illuminate\Support\Str::uuid()]);

        $this->artisan('timer:cleanup-stale')->assertExitCode(0);

        $fresh = $entry->fresh();
        $this->assertNotNull($fresh->ended_at);
        $this->assertSame(3, (int) $fresh->client_revision, 'client_revision must not be bumped by a server-side close.');

        // The machine comes back and pushes the real boundaries at a higher revision.
        $trueEnd = now()->subHours(2);
        $result = app(\App\Services\TimeEntrySyncService::class)->sync([[
            'uuid' => $fresh->idempotency_key,
            'revision' => 4,
            'started_at' => $fresh->started_at->toISOString(),
            'ended_at' => $trueEnd->toISOString(),
            'project_id' => null,
        ]], $this->user->fresh());

        $this->assertSame('ok', $result[0]['status']);
        $this->assertEqualsWithDelta(
            $trueEnd->timestamp,
            $entry->fresh()->ended_at->timestamp,
            2,
            'The agent is the only writer: its values must override the provisional close.'
        );
    }

    // ─── B2: heartbeat on a CLOSED entry is rejected ─────────────────────────

    public function test_heartbeat_on_closed_entry_is_rejected_and_creates_no_log(): void
    {
        // Redis still points at an entry that has since been closed.
        $closed = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'activity_score' => 42,
            'type' => 'tracked',
        ]);
        Redis::setex("timer:{$this->user->id}", 2592000, json_encode([
            'entry_id' => $closed->id,
            'started_at' => $closed->started_at->toISOString(),
            'project_id' => null,
            'task_id' => null,
            'state' => 'running',
        ]));

        $before = ActivityLog::where('time_entry_id', $closed->id)->count();

        try {
            $this->service->processHeartbeat(['keyboard_events' => 10, 'mouse_events' => 10]);
            $this->fail('Heartbeat on a closed entry should throw.');
        } catch (\RuntimeException $e) {
            $this->assertEquals('No timer is currently running.', $e->getMessage());
        }

        // No ActivityLog created and activity_score untouched.
        $this->assertEquals($before, ActivityLog::where('time_entry_id', $closed->id)->count());
        $this->assertEquals(42, $closed->fresh()->activity_score);
    }

    public function test_heartbeat_honors_client_capture_timestamp(): void
    {
        $this->openSession();
        $captureTime = now()->subMinutes(10);

        $log = $this->service->processHeartbeat([
            'keyboard_events' => 5,
            'mouse_events' => 5,
            'logged_at' => $captureTime->toISOString(),
        ]);

        $this->assertEqualsWithDelta($captureTime->timestamp, $log->logged_at->timestamp, 2,
            'Offline-flushed heartbeat must land at its true capture time.');
    }

    public function test_heartbeat_defaults_logged_at_to_now_when_absent(): void
    {
        $this->openSession();

        $log = $this->service->processHeartbeat(['keyboard_events' => 1, 'mouse_events' => 1]);

        $this->assertEqualsWithDelta(now()->timestamp, $log->logged_at->timestamp, 5);
    }

}
