<?php

namespace Tests\Feature\Timer;

use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\TimerService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A heartbeat belongs to the session the AGENT is in, not the one the server last heard
 * about.
 *
 * The desktop owns tracked time locally and uploads on a 10-minute batch, so after any
 * local session change — idle discard, stop/start, project switch, midnight split — the
 * server's Redis pointer still names the PREVIOUS entry. Attributing heartbeats by that
 * pointer put 25 real heartbeats (12:43:39 → 13:03:28, measured on dev) onto an entry the
 * agent had closed at 12:37:16: they spanned an idle gap and nine minutes of the next
 * session, corrupted the closed entry's final activity score, and kept a finished session
 * looking alive to the dashboard's live-elapsed clamp.
 */
class HeartbeatSessionAttributionTest extends TestCase
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
        $this->travelTo(Carbon::create(2026, 8, 10, 10, 0, 0, 'UTC'));
    }

    protected function tearDown(): void
    {
        Redis::flushdb();
        parent::tearDown();
    }

    private function makeEntry(array $attributes = []): TimeEntry
    {
        return TimeEntry::create(array_merge([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(10),
            'type' => 'tracked',
            'idempotency_key' => (string) Str::uuid(),
            'client_revision' => 1,
            'client_synced_at' => now(),
        ], $attributes));
    }

    private function pointRedisAt(TimeEntry $entry): void
    {
        Redis::setex("timer:{$this->user->id}", 2592000, json_encode([
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
            'project_id' => $entry->project_id,
            'task_id' => $entry->task_id,
            'state' => 'running',
        ]));
    }

    public function test_heartbeat_lands_on_the_session_its_uuid_names(): void
    {
        $entry = $this->makeEntry();
        $this->pointRedisAt($entry);

        $log = $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
            'session_uuid' => $entry->idempotency_key,
        ]);

        $this->assertSame($entry->id, $log->time_entry_id);
    }

    /**
     * THE REGRESSION. The agent has moved on to a session the server has not received
     * yet; the Redis pointer still names the old, now-closed one.
     */
    public function test_a_heartbeat_for_an_unsynced_session_never_lands_on_the_stale_entry(): void
    {
        $stale = $this->makeEntry([
            'started_at' => now()->subMinutes(29),
            'ended_at' => now()->subMinutes(25),
            'duration_seconds' => 240,
        ]);
        // Redis was never updated — this is exactly the window the bug lived in.
        $this->pointRedisAt($stale);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Heartbeat is for a session that has not synced yet.');

        try {
            $this->service->processHeartbeat([
                'keyboard_events' => 10,
                'mouse_events' => 20,
                // The successor session, live on the agent, unknown to the server.
                'session_uuid' => (string) Str::uuid(),
            ]);
        } finally {
            // Nothing may be written to the stale entry — that write is the bug.
            $this->assertSame(0, ActivityLog::where('time_entry_id', $stale->id)->count());
        }
    }

    public function test_a_heartbeat_for_a_closed_session_is_refused(): void
    {
        $closed = $this->makeEntry([
            'ended_at' => now()->subMinute(),
            'duration_seconds' => 540,
        ]);
        $this->pointRedisAt($closed);

        $this->expectException(\RuntimeException::class);

        $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
            'session_uuid' => $closed->idempotency_key,
        ]);
    }

    public function test_a_uuid_belonging_to_another_user_is_refused(): void
    {
        $mine = $this->makeEntry();
        $this->pointRedisAt($mine);

        $colleague = $this->createUser($this->org, 'employee');
        $theirs = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $colleague->id,
            'started_at' => now()->subMinutes(5),
            'type' => 'tracked',
            'idempotency_key' => (string) Str::uuid(),
        ]);

        $this->expectException(\RuntimeException::class);

        try {
            $this->service->processHeartbeat([
                'keyboard_events' => 10,
                'mouse_events' => 20,
                'session_uuid' => $theirs->idempotency_key,
            ]);
        } finally {
            $this->assertSame(0, ActivityLog::where('time_entry_id', $theirs->id)->count());
            $this->assertSame(0, ActivityLog::where('time_entry_id', $mine->id)->count());
        }
    }

    /**
     * Agents that predate the field must keep working — the backend ships before any
     * desktop release, and `TIMER_MIN_AGENT_VERSION` is the last lever pulled.
     */
    public function test_an_agent_that_sends_no_uuid_still_uses_the_redis_pointer(): void
    {
        $entry = $this->makeEntry();
        $this->pointRedisAt($entry);

        $log = $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
        ]);

        $this->assertSame($entry->id, $log->time_entry_id);
    }

    /**
     * With attribution fixed, the stale entry stops receiving the fresh heartbeats that
     * made it look alive — so the live-elapsed clamp can finally see it is not.
     */
    public function test_the_stale_entry_stops_looking_alive_to_the_dashboard(): void
    {
        $stale = $this->makeEntry([
            'started_at' => now()->subMinutes(29),
            'client_synced_at' => now()->subMinutes(9),
        ]);
        $this->pointRedisAt($stale);
        // Its own last real heartbeat, before the agent moved on.
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $stale->id,
            'logged_at' => now()->subMinutes(25),
            'keyboard_events' => 1,
            'mouse_events' => 1,
            'activity_score' => 10,
        ]);

        try {
            $this->service->processHeartbeat([
                'keyboard_events' => 10,
                'mouse_events' => 20,
                'session_uuid' => (string) Str::uuid(),
            ]);
        } catch (\RuntimeException) {
            // expected — the point is what it did NOT write
        }

        $status = $this->service->status();

        $this->assertTrue($status['elapsed_is_stale']);
        // Frozen at the last push (9 min ago), not counting on to 29 minutes.
        $this->assertSame(20 * 60, $status['elapsed_seconds']);
    }
}
