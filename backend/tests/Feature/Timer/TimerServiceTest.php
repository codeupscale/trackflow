<?php

namespace Tests\Feature\Timer;

use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\TimerService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class TimerServiceTest extends TestCase
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
     * Open a live session directly.
     *
     * These tests used TimerService::start() purely as a FIXTURE — they assert on
     * status(), todayTotal() and processHeartbeat(), not on starting. start() is gone
     * (the desktop agent owns session creation and pushes via TimeEntrySyncService), so
     * this creates the same end state: an open entry plus the Redis timer key that the
     * read paths key off.
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

    /**
     * Pin the clock to a safe mid-day UTC instant (10:00 UTC = 15:00 PKT) before any data
     * setup. The test user's timezone is Asia/Karachi (UTC+5); todayTotal()/status() compute
     * day boundaries in that zone. When the suite runs between 19:00–24:00 UTC, the PKT "today"
     * is a day ahead of the UTC clock, so entries created at now()->subHours(N) drift into
     * "yesterday PKT" and the exact today_total assertions flake. A mid-day instant keeps
     * subHours(1..5) safely inside the same PKT day. Laravel's TestCase::tearDown() resets
     * Carbon::setTestNow() automatically, so no manual teardown is needed.
     */
    private function freezeMidday(): void
    {
        $this->travelTo(\Illuminate\Support\Carbon::create(2026, 7, 6, 10, 0, 0, 'UTC'));
    }

    // ─── status() ────────────────────────────────────────────────────

    public function test_status_when_no_timer_running(): void
    {
        $status = $this->service->status();

        $this->assertFalse($status['running']);
        $this->assertNull($status['entry']);
        $this->assertEquals(0, $status['elapsed_seconds']);
        $this->assertArrayHasKey('today_total', $status);
        $this->assertArrayHasKey('current_day', $status);
    }

    public function test_status_when_timer_is_running(): void
    {
        $entry = $this->openSession();

        $status = $this->service->status();

        $this->assertTrue($status['running']);
        $this->assertEquals($entry->id, $status['entry']->id);
        $this->assertGreaterThanOrEqual(0, $status['elapsed_seconds']);
        $this->assertArrayHasKey('today_total', $status);
        $this->assertArrayHasKey('project_today_total', $status);
    }

    public function test_status_includes_completed_entries_in_today_total(): void
    {
        $this->freezeMidday();

        // Create a completed entry for today
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $status = $this->service->status();

        $this->assertGreaterThanOrEqual(3600, $status['today_total']);
    }

    public function test_status_with_project_filter(): void
    {
        $this->freezeMidday();

        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
        ]);

        // Create entry for this project
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => $project->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        // Create entry for different project
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => null,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $status = $this->service->status($project->id);

        // Should only include the project-specific entry
        $this->assertEquals(3600, $status['today_total']);
    }

    // ─── all_projects_today_total (global sum, never scoped) ─────────
    // Regression: bugs/desktop-today-total-project-scoped-when-project-selected.md
    // The desktop "Today, all projects" line + tray tooltip must never show a
    // project-scoped total when a project is selected while the timer is stopped.

    public function test_status_stopped_with_project_returns_scoped_today_total_but_global_all_projects_total(): void
    {
        $this->freezeMidday();

        $project = Project::factory()->create(['organization_id' => $this->org->id]);

        // 1h on the selected project
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => $project->id,
            'started_at' => now()->subHours(4),
            'ended_at' => now()->subHours(3),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        // 1h on a different (null) project
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => null,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $status = $this->service->status($project->id);

        // today_total keeps historical scoped semantics.
        $this->assertEquals(3600, $status['today_total']);
        // all_projects_today_total must be the GLOBAL sum regardless of the project filter.
        $this->assertArrayHasKey('all_projects_today_total', $status);
        $this->assertEquals(7200, $status['all_projects_today_total']);
        // project_today_total is now populated in the stopped branch (was 0 before).
        $this->assertEquals(3600, $status['project_today_total']);
    }

    public function test_status_stopped_without_project_has_equal_today_and_all_projects_totals(): void
    {
        $this->freezeMidday();

        $project = Project::factory()->create(['organization_id' => $this->org->id]);

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => $project->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $status = $this->service->status();

        $this->assertEquals(3600, $status['today_total']);
        $this->assertEquals(3600, $status['all_projects_today_total']);
    }

    /**
     * Redis is a cache, not the source of truth. When the key is evicted or Redis
     * restarts, status() must recover the live session from the DB and REPAIR the key —
     * otherwise the web dashboard shows the user as idle while they are tracking.
     *
     * (Moved here from the retired TimerSyncTest, which otherwise only covered the
     * deleted start/stop RPC. The session is created directly rather than via the old
     * TimerService::start(), which no longer exists.)
     */
    public function test_status_falls_back_to_db_when_redis_key_missing(): void
    {
        $startedAt = now()->subMinutes(5);
        $entry = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => $startedAt,
            'type' => 'tracked',
            // An entry only exists server-side because the agent pushed it, and every
            // push stamps this. Omitting it made the fixture describe a state that
            // cannot occur — and one the live-elapsed clamp now (correctly) treats as
            // an agent with no proof of life, freezing elapsed at 0.
            'client_synced_at' => now()->subSeconds(20),
        ]);

        Redis::del("timer:{$this->user->id}");

        $status = $this->service->status();

        $this->assertTrue($status['running'], 'status() must report running when DB has an open entry.');
        $this->assertEquals($entry->id, $status['entry']->id);
        $this->assertGreaterThan(0, $status['elapsed_seconds']);
        $this->assertEqualsWithDelta(
            $startedAt->timestamp,
            $status['entry']->started_at->timestamp,
            2,
            'Redis repair must preserve the real started_at.'
        );

        $this->assertNotNull(Redis::get("timer:{$this->user->id}"), 'status() must repair the evicted key.');
    }

    public function test_status_running_all_projects_total_is_global_and_includes_elapsed(): void
    {
        $this->freezeMidday();

        $projectA = Project::factory()->create(['organization_id' => $this->org->id]);
        $projectB = Project::factory()->create(['organization_id' => $this->org->id]);
        $projectA->members()->attach($this->user->id);

        // Completed 1h on project B (a DIFFERENT project than the one requested).
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => $projectB->id,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        // Start a running timer on project A.
        $this->openSession(['project_id' => $projectA->id]);

        // Request status scoped to project A.
        $status = $this->service->status($projectA->id);

        // today_total is scoped to project A (only the running elapsed, ~0).
        $this->assertLessThan(3600, $status['today_total']);
        // all_projects_today_total includes project B's completed hour + A's elapsed.
        $this->assertGreaterThanOrEqual(3600, $status['all_projects_today_total']);
    }

    // ─── todayTotal() ────────────────────────────────────────────────

    public function test_today_total_sums_completed_entries(): void
    {
        $this->freezeMidday();

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
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $total = $this->service->todayTotal();

        $this->assertEquals(7200, $total);
    }

    public function test_today_total_includes_running_entry_elapsed(): void
    {
        $this->freezeMidday();

        // Create a completed entry
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        // Start a running timer
        $this->openSession();

        $total = $this->service->todayTotal();

        // Should be >= 3600 (completed) + 0 (just started)
        $this->assertGreaterThanOrEqual(3600, $total);
    }

    public function test_today_total_excludes_idle_entries(): void
    {
        $this->freezeMidday();

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'idle', // Should be excluded
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $total = $this->service->todayTotal();

        $this->assertEquals(3600, $total);
    }

    public function test_today_total_with_project_filter(): void
    {
        $this->freezeMidday();

        $project = Project::factory()->create(['organization_id' => $this->org->id]);

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => $project->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => null, // different project
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 1800,
            'type' => 'tracked',
        ]);

        $total = $this->service->todayTotal($project->id);

        $this->assertEquals(3600, $total);
    }

    // ─── processHeartbeat() ──────────────────────────────────────────

    public function test_process_heartbeat_creates_activity_log(): void
    {
        $entry = $this->openSession();

        $log = $this->service->processHeartbeat([
            'keyboard_events' => 100,
            'mouse_events' => 200,
            'active_app' => 'VS Code',
            'active_window_title' => 'index.js',
        ]);

        $this->assertInstanceOf(ActivityLog::class, $log);
        $this->assertEquals($entry->id, $log->time_entry_id);
        $this->assertEquals(100, $log->keyboard_events);
        $this->assertEquals(200, $log->mouse_events);
        $this->assertEquals('VS Code', $log->active_app);
    }

    public function test_process_heartbeat_throws_when_no_timer_running(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('No timer is currently running.');

        $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
        ]);
    }

    public function test_process_heartbeat_updates_activity_score_ema(): void
    {
        $entry = $this->openSession();

        // First heartbeat — sets initial score
        $this->service->processHeartbeat([
            'keyboard_events' => 150,
            'mouse_events' => 150,
        ]);

        $entry->refresh();
        // total = 300, score = min(100, round(300/300*100)) = 100
        $this->assertEquals(100, $entry->activity_score);

        // Second heartbeat — EMA blends: alpha=0.3, new=0 => 0.3*0 + 0.7*100 = 70
        $this->service->processHeartbeat([
            'keyboard_events' => 0,
            'mouse_events' => 0,
        ]);

        $entry->refresh();
        $this->assertEquals(70, $entry->activity_score);
    }

    public function test_process_heartbeat_updates_user_last_active_at(): void
    {
        $this->openSession();

        $beforeUpdate = $this->user->last_active_at;

        $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
        ]);

        $this->user->refresh();
        $this->assertNotNull($this->user->last_active_at);
    }

    public function test_today_total_excludes_yesterday_entries(): void
    {
        $this->freezeMidday();

        // Create entry from yesterday
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subDay()->startOfDay()->addHours(10),
            'ended_at' => now()->subDay()->startOfDay()->addHours(11),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        // Create entry for today
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $total = $this->service->todayTotal();

        $this->assertEquals(3600, $total);
    }

    public function test_today_total_excludes_running_entries_without_ended_at(): void
    {
        // A running entry without ended_at should not be counted in the DB sum
        // (but its elapsed time should be added separately if timer is running via Redis)
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHour(),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);

        // Without Redis timer data, this entry is orphaned and should not be counted
        $total = $this->service->todayTotal();
        $this->assertEquals(0, $total);
    }
}
