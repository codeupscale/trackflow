<?php

namespace Tests\Feature\Timer;

use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\TimerService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

/**
 * An OPEN entry's elapsed must never be extrapolated past the agent's last proof of life.
 *
 * The desktop owns tracked time locally and uploads on a 10-minute batch, so between
 * pushes the server's open entry can be a stale replica of state the agent has already
 * changed. Measuring it to now() does not merely lag — it INVENTS time and grows it every
 * second. Observed on dev: an entry the agent closed locally at 12:33:38→12:37:16 was
 * still being counted at 13:02:36, so the dashboard read 28:58 while the desktop showed
 * the true 11:17, and the difference was an idle gap the agent had already discarded.
 */
class LiveElapsedClampTest extends TestCase
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
        // Mid-day UTC: the user's day boundaries are Asia/Karachi (UTC+5), and a late-UTC
        // clock would push these fixtures into "yesterday" locally.
        $this->travelTo(Carbon::create(2026, 8, 10, 10, 0, 0, 'UTC'));
    }

    protected function tearDown(): void
    {
        Redis::flushdb();
        parent::tearDown();
    }

    private function openSession(Carbon $startedAt, ?Carbon $clientSyncedAt = null): TimeEntry
    {
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => $startedAt,
            'type' => 'tracked',
            'client_revision' => 1,
            'client_synced_at' => $clientSyncedAt,
        ]);

        Redis::setex("timer:{$this->user->id}", 2592000, json_encode([
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
            'project_id' => null,
            'task_id' => null,
            'state' => 'running',
        ]));

        return $entry;
    }

    private function heartbeat(TimeEntry $entry, Carbon $at): void
    {
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => $at,
            'keyboard_events' => 5,
            'mouse_events' => 5,
            'activity_score' => 50,
        ]);
    }

    public function test_a_live_agent_still_counts_to_now(): void
    {
        $entry = $this->openSession(now()->subMinutes(20));
        // Heartbeats arrive every 30s while the agent is online.
        $this->heartbeat($entry, now()->subSeconds(20));

        $status = $this->service->status();

        $this->assertSame(1200, $status['elapsed_seconds']);
        $this->assertFalse($status['elapsed_is_stale']);
    }

    public function test_a_quiet_agent_freezes_the_clock_at_its_last_heartbeat(): void
    {
        // The dev case: started 29 min ago, agent went quiet 25 min ago (idle, then the
        // local session was split without the server hearing about it yet).
        $entry = $this->openSession(now()->subMinutes(29));
        $this->heartbeat($entry, now()->subMinutes(25));

        $status = $this->service->status();

        // 29 - 25 = 4 minutes of time we actually have evidence for, NOT 29.
        $this->assertSame(240, $status['elapsed_seconds']);
        $this->assertTrue($status['elapsed_is_stale']);
        $this->assertSame(
            now()->subMinutes(25)->toISOString(),
            $status['live_as_of'],
        );
    }

    public function test_the_frozen_figure_does_not_grow_with_the_wall_clock(): void
    {
        $entry = $this->openSession(now()->subMinutes(29));
        $this->heartbeat($entry, now()->subMinutes(25));

        $first = $this->service->status()['elapsed_seconds'];
        $this->travel(7)->minutes();
        $second = $this->service->status()['elapsed_seconds'];

        // This is the whole point: before the clamp, seven minutes of wall clock added
        // seven minutes of "tracked" time to a session nobody was working.
        $this->assertSame($first, $second);
    }

    public function test_a_sync_push_alone_counts_as_proof_of_life(): void
    {
        // No heartbeats at all (they FK to a synced entry and can lag), but the agent
        // pushed its live session a moment ago — that push stamps client_synced_at.
        $entry = $this->openSession(now()->subMinutes(20), now()->subSeconds(30));

        $status = $this->service->status();

        $this->assertSame(1200, $status['elapsed_seconds']);
        $this->assertFalse($status['elapsed_is_stale']);
    }

    public function test_today_totals_stop_inflating_too(): void
    {
        // A closed entry plus a stale open one. The total must contain the closed work
        // and only the evidenced part of the open entry.
        TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(90),
            'ended_at' => now()->subMinutes(80),
            'duration_seconds' => 600,
            'type' => 'tracked',
        ]);

        $entry = $this->openSession(now()->subMinutes(29));
        $this->heartbeat($entry, now()->subMinutes(25));

        $status = $this->service->status();
        $this->assertSame(600 + 240, $status['all_projects_today_total']);

        // todayTotal() adds live elapsed through the same path, so it must agree.
        $this->assertSame(600 + 240, $this->service->todayTotal());
    }

    public function test_nothing_running_reports_no_liveness_qualifier(): void
    {
        $status = $this->service->status();

        $this->assertFalse($status['running']);
        $this->assertNull($status['live_as_of']);
        $this->assertFalse($status['elapsed_is_stale']);
    }
}
