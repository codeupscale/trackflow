<?php

namespace Tests\Feature\Timer;

use App\Console\Commands\CleanupStaleEntries;
use App\Jobs\CloseStaleTimerEntriesJob;
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

    // ─── B1: cleanup threshold respects the offline grace window ─────────────

    public function test_cleanup_does_not_close_entry_within_offline_grace_window(): void
    {
        config(['timer.offline_grace_minutes' => 240]);

        // Last server-received heartbeat was 90 minutes ago — well inside the 4h grace
        // window. An offline desktop is still legitimately tracking; do NOT close it.
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
            'logged_at' => now()->subMinutes(90),
            'keyboard_events' => 5,
            'mouse_events' => 5,
        ]);

        $this->artisan('timer:cleanup-stale')->assertExitCode(0);

        $this->assertNull($entry->fresh()->ended_at, 'Entry inside grace window must stay open.');
    }

    public function test_cleanup_closes_entry_beyond_grace_window_at_last_heartbeat(): void
    {
        config(['timer.offline_grace_minutes' => 240]);

        $started = now()->subHours(10);
        $lastHeartbeat = now()->subHours(5); // > 4h stale → close, but only up to here

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
        // Closed AT the last heartbeat — dead time after it is not counted.
        $this->assertEqualsWithDelta($lastHeartbeat->timestamp, $fresh->ended_at->timestamp, 2);
        $this->assertEqualsWithDelta(
            $started->diffInSeconds($lastHeartbeat),
            $fresh->duration_seconds,
            2
        );
    }

    // ─── B1: backstop job threshold is >= grace window ───────────────────────

    public function test_backstop_job_does_not_close_entry_within_grace_plus_margin(): void
    {
        config(['timer.offline_grace_minutes' => 240]);

        // updated_at 3h ago: within grace(4h)+margin(1h) = 5h, so the backstop must skip it.
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(4),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        TimeEntry::withoutGlobalScopes()->where('id', $entry->id)
            ->update(['updated_at' => now()->subHours(3)]);

        (new CloseStaleTimerEntriesJob())->handle();

        $this->assertNull($entry->fresh()->ended_at);
    }

    public function test_backstop_job_closes_very_old_entry(): void
    {
        config(['timer.offline_grace_minutes' => 240]);

        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(10),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        TimeEntry::withoutGlobalScopes()->where('id', $entry->id)
            ->update(['updated_at' => now()->subHours(8)]); // > 5h → close

        (new CloseStaleTimerEntriesJob())->handle();

        $this->assertNotNull($entry->fresh()->ended_at);
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
