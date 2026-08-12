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
            'active_seconds' => 12,
            'activity_score' => 50,
        ]);
    }

    /**
     * A heartbeat the agent keeps sending while nobody is at the keyboard. These flow
     * for the whole idle-threshold window before the prompt appears.
     */
    private function idleHeartbeat(TimeEntry $entry, Carbon $at): void
    {
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => $at,
            'keyboard_events' => 0,
            'mouse_events' => 0,
            'active_seconds' => 0,
            'activity_score' => 0,
        ]);
    }

    private function setIdleTimeout(int $minutes): void
    {
        $this->org->settings = array_merge($this->org->settings ?? [], [
            'idle_timeout' => $minutes,
        ]);
        $this->org->save();
        $this->user->refresh();
    }

    public function test_a_working_user_still_counts_to_now(): void
    {
        $this->setIdleTimeout(10);
        $entry = $this->openSession(now()->subMinutes(20));
        // Heartbeats arrive every 30s while the agent is online.
        $this->heartbeat($entry, now()->subSeconds(20));

        $status = $this->service->status();

        $this->assertSame(1200, $status['elapsed_seconds']);
        $this->assertFalse($status['elapsed_is_stale']);
    }

    public function test_a_pause_shorter_than_the_idle_threshold_keeps_counting(): void
    {
        // Reading a document for four minutes with a ten-minute threshold is work by the
        // product's own definition — the desktop has not raised the prompt, so the web
        // must not freeze either, or the counter would flicker constantly.
        $this->setIdleTimeout(10);
        $entry = $this->openSession(now()->subMinutes(20));
        $this->heartbeat($entry, now()->subMinutes(4));

        $status = $this->service->status();

        $this->assertSame(1200, $status['elapsed_seconds']);
        $this->assertFalse($status['elapsed_is_stale']);
    }

    /**
     * THE REPORTED CASE, to the second.
     *
     * Session started 14:30:19. Last real input 14:49:14. The org's idle threshold is
     * 10 minutes, so the agent went on sending zero-activity heartbeats until it raised
     * the prompt at 14:58:50, and its 10-minute batch pushed at 15:00:00 while the user
     * was still away. At 15:08:30 the desktop showed 18:55 (measured to the last input)
     * and the dashboard showed 29:51 (measured to that sync push).
     */
    public function test_it_freezes_at_the_last_input_not_the_last_sync_or_heartbeat(): void
    {
        $this->setIdleTimeout(10);
        $startedAt = Carbon::parse('2026-08-10 14:30:19', 'UTC');
        $this->travelTo(Carbon::parse('2026-08-10 15:08:30', 'UTC'));

        // The push that happened while the user was idle — proof the AGENT is up, and
        // the signal that produced the wrong 29:51.
        $entry = $this->openSession($startedAt, Carbon::parse('2026-08-10 15:00:00', 'UTC'));

        $this->heartbeat($entry, Carbon::parse('2026-08-10 14:49:14', 'UTC'));
        // Zero-activity heartbeats through the idle-threshold window.
        $this->idleHeartbeat($entry, Carbon::parse('2026-08-10 14:55:00', 'UTC'));
        $this->idleHeartbeat($entry, Carbon::parse('2026-08-10 14:58:50', 'UTC'));

        $status = $this->service->status();

        // 14:49:14 - 14:30:19 = 18m55s. The exact figure the desktop showed.
        $this->assertSame(18 * 60 + 55, $status['elapsed_seconds']);
        $this->assertTrue($status['elapsed_is_stale']);
        $this->assertSame(
            Carbon::parse('2026-08-10 14:49:14', 'UTC')->toISOString(),
            $status['live_as_of'],
        );
    }

    public function test_the_frozen_figure_does_not_grow_with_the_wall_clock(): void
    {
        $this->setIdleTimeout(10);
        $entry = $this->openSession(now()->subMinutes(29));
        $this->heartbeat($entry, now()->subMinutes(25));

        $first = $this->service->status()['elapsed_seconds'];
        $this->travel(7)->minutes();
        $second = $this->service->status()['elapsed_seconds'];

        // This is the whole point: before the clamp, seven minutes of wall clock added
        // seven minutes of "tracked" time to a session nobody was working.
        $this->assertSame($first, $second);
    }

    /**
     * A sync push says the AGENT is running, which is a different question. It keeps
     * advancing on the 10-minute batch throughout an idle period, so treating it as
     * liveness credits exactly the time the desktop has already stopped counting.
     */
    public function test_a_sync_push_is_not_proof_the_user_is_working(): void
    {
        $this->setIdleTimeout(10);
        $entry = $this->openSession(now()->subMinutes(40), now()->subSeconds(30));
        $this->heartbeat($entry, now()->subMinutes(35));

        $status = $this->service->status();

        $this->assertSame(300, $status['elapsed_seconds']);
        $this->assertTrue($status['elapsed_is_stale']);
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
