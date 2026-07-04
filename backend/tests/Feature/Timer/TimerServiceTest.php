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

    // ─── start() ──────────────────────────────────────────────────────

    public function test_start_creates_time_entry_and_sets_redis(): void
    {
        $entry = $this->service->start([]);

        $this->assertInstanceOf(TimeEntry::class, $entry);
        $this->assertEquals($this->user->id, $entry->user_id);
        $this->assertEquals($this->org->id, $entry->organization_id);
        $this->assertEquals('tracked', $entry->type);
        $this->assertNotNull($entry->started_at);
        $this->assertNull($entry->ended_at);
        $this->assertNull($entry->duration_seconds);

        // Verify Redis key was set
        $redisKey = "timer:{$this->user->id}";
        $data = json_decode(Redis::get($redisKey), true);
        $this->assertEquals($entry->id, $data['entry_id']);
        $this->assertNotNull($data['started_at']);
    }

    public function test_start_with_project_id(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
        ]);
        // Assign employee to project
        $project->members()->attach($this->user->id);

        $entry = $this->service->start(['project_id' => $project->id]);

        $this->assertEquals($project->id, $entry->project_id);
    }

    public function test_start_with_task_id_and_notes(): void
    {
        $entry = $this->service->start([
            'task_id' => null,
            'notes' => 'Working on feature X',
        ]);

        $this->assertEquals('Working on feature X', $entry->notes);
    }

    public function test_start_throws_authorization_exception_for_unassigned_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
        ]);
        // Do NOT assign the employee to the project

        $this->expectException(AuthorizationException::class);
        $this->expectExceptionMessage('You are not assigned to this project.');

        $this->service->start(['project_id' => $project->id]);
    }

    public function test_start_allows_admin_on_any_project(): void
    {
        $admin = $this->createUser($this->org, 'org_manager');
        $this->actingAs($admin, 'sanctum');

        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
        ]);
        // Admin is NOT explicitly assigned, but hasRole('admin') returns true in isAssignedTo

        $result = (new TimerService())->start(['project_id' => $project->id]);
        $this->assertEquals($project->id, $result['entry']->project_id);
    }

    public function test_start_throws_when_project_belongs_to_different_org(): void
    {
        $otherOrg = $this->createOrganization();
        $otherProject = Project::factory()->create([
            'organization_id' => $otherOrg->id,
        ]);

        $this->expectException(\Illuminate\Database\Eloquent\ModelNotFoundException::class);
        $this->service->start(['project_id' => $otherProject->id]);
    }

    public function test_start_dispatches_timer_started_event(): void
    {
        \Illuminate\Support\Facades\Event::fake([\App\Events\TimerStarted::class]);

        $entry = $this->service->start([]);

        \Illuminate\Support\Facades\Event::assertDispatched(\App\Events\TimerStarted::class, function ($event) use ($entry) {
            return $event->entry->id === $entry->id;
        });
    }

    // ─── stop() ──────────────────────────────────────────────────────

    public function test_stop_finalizes_entry_and_clears_redis(): void
    {
        // Start a timer first
        $entry = $this->service->start([]);
        $entryId = $entry->id;

        // Wait a tiny bit for duration calculation
        sleep(1);

        $stopped = $this->service->stop();

        $this->assertEquals($entryId, $stopped->id);
        $this->assertNotNull($stopped->ended_at);
        $this->assertNotNull($stopped->duration_seconds);
        $this->assertGreaterThanOrEqual(1, $stopped->duration_seconds);

        // Redis should be cleared
        $redisKey = "timer:{$this->user->id}";
        $this->assertNull(Redis::get($redisKey));
    }

    public function test_stop_throws_when_no_timer_running(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('No timer is currently running.');

        $this->service->stop();
    }

    public function test_stop_dispatches_timer_stopped_event(): void
    {
        $this->service->start([]);

        \Illuminate\Support\Facades\Event::fake([\App\Events\TimerStopped::class]);

        $stopped = $this->service->stop();

        \Illuminate\Support\Facades\Event::assertDispatched(\App\Events\TimerStopped::class, function ($event) use ($stopped) {
            return $event->entry->id === $stopped->id;
        });
    }

    public function test_stop_computes_final_activity_score_from_logs(): void
    {
        $entry = $this->service->start([]);

        // Create activity logs for this entry
        ActivityLog::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'keyboard_events' => 150,
            'mouse_events' => 150,
        ]);
        ActivityLog::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $entry->id,
            'keyboard_events' => 300,
            'mouse_events' => 0,
        ]);

        $stopped = $this->service->stop();

        // Score = avg of [min(100, round(300/300*100)), min(100, round(300/300*100))] = avg(100, 100) = 100
        $this->assertNotNull($stopped->activity_score);
        $this->assertEquals(100, $stopped->activity_score);
    }

    public function test_stop_returns_null_activity_score_when_no_logs(): void
    {
        $entry = $this->service->start([]);
        $stopped = $this->service->stop();

        // No activity logs, so computeFinalActivityScore returns null
        // The fallback is $entry->activity_score ?? 0
        $this->assertEquals(0, $stopped->activity_score);
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
        $entry = $this->service->start([]);

        $status = $this->service->status();

        $this->assertTrue($status['running']);
        $this->assertEquals($entry->id, $status['entry']->id);
        $this->assertGreaterThanOrEqual(0, $status['elapsed_seconds']);
        $this->assertArrayHasKey('today_total', $status);
        $this->assertArrayHasKey('project_today_total', $status);
    }

    public function test_status_includes_completed_entries_in_today_total(): void
    {
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

    public function test_status_running_all_projects_total_is_global_and_includes_elapsed(): void
    {
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
        $this->service->start(['project_id' => $projectA->id]);

        // Request status scoped to project A.
        $status = $this->service->status($projectA->id);

        // today_total is scoped to project A (only the running elapsed, ~0).
        $this->assertLessThan(3600, $status['today_total']);
        // all_projects_today_total includes project B's completed hour + A's elapsed.
        $this->assertGreaterThanOrEqual(3600, $status['all_projects_today_total']);
    }

    // ─── Multi-tenancy isolation ─────────────────────────────────────

    public function test_start_isolates_entries_by_organization(): void
    {
        // Create entry for org A
        $entryA = $this->service->start([]);

        // Create user in org B
        $orgB = $this->createOrganization();
        $userB = $this->createUser($orgB, 'employee');
        $this->actingAs($userB, 'sanctum');

        $serviceB = new TimerService();
        $entryB = $serviceB->start([]);

        $this->assertNotEquals($entryA->organization_id, $entryB->organization_id);
        $this->assertEquals($this->org->id, $entryA->organization_id);
        $this->assertEquals($orgB->id, $entryB->organization_id);
    }

    public function test_stop_cannot_stop_another_users_timer(): void
    {
        // Start timer for user A
        $this->service->start([]);

        // Switch to user B (same org)
        $userB = $this->createUser($this->org, 'employee');
        $this->actingAs($userB, 'sanctum');

        $serviceB = new TimerService();

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('No timer is currently running.');

        $serviceB->stop();
    }

    // ─── todayTotal() ────────────────────────────────────────────────

    public function test_today_total_sums_completed_entries(): void
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
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $total = $this->service->todayTotal();

        $this->assertEquals(7200, $total);
    }

    public function test_today_total_includes_running_entry_elapsed(): void
    {
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
        $this->service->start([]);

        $total = $this->service->todayTotal();

        // Should be >= 3600 (completed) + 0 (just started)
        $this->assertGreaterThanOrEqual(3600, $total);
    }

    public function test_today_total_excludes_idle_entries(): void
    {
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
        $entry = $this->service->start([]);

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
        $entry = $this->service->start([]);

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
        $this->service->start([]);

        $beforeUpdate = $this->user->last_active_at;

        $this->service->processHeartbeat([
            'keyboard_events' => 10,
            'mouse_events' => 20,
        ]);

        $this->user->refresh();
        $this->assertNotNull($this->user->last_active_at);
    }

    // ─── pause() ─────────────────────────────────────────────────────

    public function test_pause_stops_timer_without_creating_idle_entry(): void
    {
        $project = Project::factory()->create(['organization_id' => $this->org->id]);
        $project->members()->attach($this->user->id);

        $this->service->start(['project_id' => $project->id]);

        $stoppedEntry = $this->service->pause();

        $this->assertNotNull($stoppedEntry->ended_at);

        // Verify no idle entry was created (zero-duration idle entries were removed
        // because they corrupted duration totals and reports)
        $idleEntry = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $this->user->id)
            ->where('type', 'idle')
            ->latest('id')
            ->first();

        $this->assertNull($idleEntry);
    }

    // ─── reportIdle() ────────────────────────────────────────────────

    public function test_report_idle_discard_action(): void
    {
        $entry = $this->service->start([]);
        $entryId = $entry->id;

        $idleStart = now()->subMinutes(5);
        $idleEnd = now();

        $result = $this->service->reportIdle([
            'idle_started_at' => $idleStart->toISOString(),
            'idle_ended_at' => $idleEnd->toISOString(),
            'idle_seconds' => 300,
            'action' => 'discard',
        ]);

        // Original entry should be shortened
        $originalEntry = TimeEntry::withoutGlobalScopes()->find($entryId);
        $this->assertNotNull($originalEntry->ended_at);

        // Idle entry should be created
        $this->assertNotNull($result['idle_entry']);
        $this->assertEquals('idle', $result['idle_entry']->type);

        // New running entry should be created
        $this->assertNotNull($result['new_entry']);
        $this->assertEquals('tracked', $result['new_entry']->type);
        $this->assertNull($result['new_entry']->ended_at);

        // Redis should point to the new entry
        $redisData = json_decode(Redis::get("timer:{$this->user->id}"), true);
        $this->assertEquals($result['new_entry']->id, $redisData['entry_id']);
    }

    public function test_report_idle_returns_nulls_when_no_timer(): void
    {
        $result = $this->service->reportIdle([
            'idle_started_at' => now()->subMinutes(5)->toISOString(),
            'idle_ended_at' => now()->toISOString(),
            'idle_seconds' => 300,
            'action' => 'discard',
        ]);

        $this->assertNull($result['idle_entry']);
        $this->assertNull($result['new_entry']);
    }

    public function test_report_idle_reassign_on_stopped_timer_splits_closed_entry(): void
    {
        // Scenario: user reassigned idle time while offline, then stopped the timer
        // before the offline queue flushed. By flush time the timer is stopped (no
        // Redis) and the entry is closed. The reassign must still split the CLOSED
        // entry historically — WITHOUT resurrecting a running timer.
        $target = Project::factory()->create(['organization_id' => $this->org->id]);
        $target->members()->attach($this->user->id);

        $start = now()->subMinutes(10);
        $end = now();
        $closed = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'project_id' => null, // original (default) project
            'started_at' => $start,
            'ended_at' => $end,
            'duration_seconds' => 600,
            'type' => 'tracked',
        ]);

        $idleStart = (clone $start)->addMinutes(1); // 1 min of work, then idle
        $idleEnd = (clone $start)->addMinutes(8);   // 7 min idle window

        // No Redis timer set — timer is stopped.
        $result = $this->service->reportIdle([
            'time_entry_id' => $closed->id,
            'idle_started_at' => $idleStart->toISOString(),
            'idle_ended_at' => $idleEnd->toISOString(),
            'idle_seconds' => 420,
            'action' => 'reassign',
            'project_id' => $target->id,
        ]);

        // No running timer reopened.
        $this->assertNull($result['new_entry']);
        $this->assertNotNull($result['idle_entry']);
        $this->assertNull(Redis::get("timer:{$this->user->id}"));

        // Original entry shortened to idle-start.
        $orig = TimeEntry::withoutGlobalScopes()->find($closed->id);
        $this->assertEqualsWithDelta($idleStart->timestamp, $orig->ended_at->timestamp, 1);

        // Reassigned tracked entry on the target project for the full idle window.
        $reassigned = TimeEntry::withoutGlobalScopes()
            ->where('project_id', $target->id)->where('type', 'tracked')->first();
        $this->assertNotNull($reassigned);
        $this->assertEqualsWithDelta(420, $reassigned->duration_seconds, 1);

        // Post-idle remainder on the original project — CLOSED (not running).
        $remainder = TimeEntry::withoutGlobalScopes()
            ->where('id', '!=', $closed->id)
            ->where('type', 'tracked')
            ->whereNull('project_id')
            ->first();
        $this->assertNotNull($remainder);
        $this->assertNotNull($remainder->ended_at);
        $this->assertEqualsWithDelta($end->timestamp, $remainder->ended_at->timestamp, 1);

        // Idempotent: a replay finds the entry already shortened and no-ops.
        $again = $this->service->reportIdle([
            'time_entry_id' => $closed->id,
            'idle_started_at' => $idleStart->toISOString(),
            'idle_ended_at' => $idleEnd->toISOString(),
            'idle_seconds' => 420,
            'action' => 'reassign',
            'project_id' => $target->id,
        ]);
        $this->assertNull($again['idle_entry']);
        $this->assertNull($again['new_entry']);
    }

    // ─── Edge cases ──────────────────────────────────────────────────

    public function test_start_stop_start_cycle_works(): void
    {
        $entry1 = $this->service->start([]);
        $this->service->stop();

        $entry2 = $this->service->start([]);
        $this->assertNotEquals($entry1->id, $entry2->id);

        $stopped = $this->service->stop();
        $this->assertEquals($entry2->id, $stopped->id);
    }

    public function test_today_total_excludes_yesterday_entries(): void
    {
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
