<?php

namespace Tests\Feature\Timer;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\TimerService;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

/**
 * Regression tests for the timer-sync data-integrity bugs (bugs/timer-sync-bugs.md):
 *   BUG 1 — offline start loses hours because started_at was hardcoded to now().
 *   BUG 1 — reversed intervals were abs()-masked into bogus positive durations.
 *   BUG 3 — duplicate start crashed with 500 instead of returning the open entry.
 *   BUG 3 — idempotency key could resurrect an already-closed entry as a live session.
 *   BUG 3 — offline stop closed "the latest open entry" instead of the intended one.
 *
 * These exercise the REAL Redis (test env points at 127.0.0.1:6380) and the REAL
 * partial unique index idx_one_active_timer_per_user, so they cover the actual paths
 * the desktop reconcile flow hits.
 */
class TimerSyncTest extends TestCase
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

    // ─── BUG 1: offline started_at is honored ────────────────────────────────

    public function test_start_honors_offline_started_at(): void
    {
        $realStart = now()->subHours(2);

        $entry = $this->service->start([
            'started_at' => $realStart->toISOString(),
        ]);

        // The server must persist the REAL local start, not reconcile-moment now().
        $this->assertEqualsWithDelta(
            $realStart->timestamp,
            $entry->started_at->timestamp,
            2,
            'Offline started_at was not honored — hours would be lost.'
        );

        // Redis anchor must also reflect the real start.
        $data = json_decode(Redis::get("timer:{$this->user->id}"), true);
        $this->assertEqualsWithDelta($realStart->timestamp, \Carbon\Carbon::parse($data['started_at'])->timestamp, 2);
    }

    public function test_start_defaults_to_now_when_no_started_at(): void
    {
        $entry = $this->service->start([]);

        $this->assertEqualsWithDelta(now()->timestamp, $entry->started_at->timestamp, 5);
    }

    public function test_start_rejects_future_started_at_beyond_skew(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('started_at cannot be in the future.');

        // 1 hour ahead — well beyond the 5-minute forward-skew tolerance.
        $this->service->start([
            'started_at' => now()->addHour()->toISOString(),
        ]);
    }

    public function test_start_clamps_small_forward_skew_to_now(): void
    {
        // 2 minutes ahead is within the 5-minute tolerance: accepted but clamped to now.
        $entry = $this->service->start([
            'started_at' => now()->addMinutes(2)->toISOString(),
        ]);

        $this->assertLessThanOrEqual(now()->timestamp + 1, $entry->started_at->timestamp);
    }

    public function test_start_rejects_started_at_too_far_in_the_past(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('started_at is too far in the past.');

        // > 24h in the past — treated as a corrupt clock.
        $this->service->start([
            'started_at' => now()->subDays(2)->toISOString(),
        ]);
    }

    public function test_start_endpoint_returns_422_for_bad_started_at(): void
    {
        $response = $this->postJson('/api/v1/timer/start', [
            'started_at' => now()->addHour()->toISOString(),
        ]);

        $response->assertStatus(422)
            ->assertJsonFragment(['message' => 'started_at cannot be in the future.']);
    }

    // ─── BUG 1: reversed intervals are rejected, not abs()-masked ────────────

    public function test_stop_rejects_reversed_interval(): void
    {
        $entry = $this->service->start([
            'started_at' => now()->subHour()->toISOString(),
        ]);

        // ended_at BEFORE started_at must be rejected outright (no bogus positive duration).
        $this->expectException(\InvalidArgumentException::class);

        $this->service->stop([
            'time_entry_id' => $entry->id,
            'started_at' => now()->subHour()->toISOString(),
            'ended_at' => now()->subHours(2)->toISOString(),
        ]);
    }

    public function test_stop_computes_duration_from_validated_offline_timestamps(): void
    {
        $entry = $this->service->start([
            'started_at' => now()->subHours(3)->toISOString(),
        ]);

        $start = now()->subHours(3);
        $end = now()->subHour(); // exactly 2h later

        $stopped = $this->service->stop([
            'time_entry_id' => $entry->id,
            'started_at' => $start->toISOString(),
            'ended_at' => $end->toISOString(),
        ]);

        $this->assertEqualsWithDelta(7200, $stopped->duration_seconds, 2);
        $this->assertEqualsWithDelta($start->timestamp, $stopped->started_at->timestamp, 2);
        $this->assertEqualsWithDelta($end->timestamp, $stopped->ended_at->timestamp, 2);
    }

    // ─── BUG 3: stop targets a SPECIFIC entry ────────────────────────────────

    public function test_stop_targets_specific_entry_and_leaves_running_session_untouched(): void
    {
        // An OLD session that was already closed server-side, but whose stop response was
        // lost on weak network so the desktop replays the stop. The unique index means it
        // can only be CLOSED while a different session is open.
        $oldEntry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(5),
            'ended_at' => now()->subHours(4),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        // A brand-new running session is the one Redis points at (the only open entry).
        $newEntry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(2),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        Redis::setex("timer:{$this->user->id}", 2592000, json_encode([
            'entry_id' => $newEntry->id,
            'started_at' => $newEntry->started_at->toISOString(),
            'project_id' => null,
            'task_id' => null,
        ]));

        // Replayed reconcile stop for the OLD entry id. Old behavior closed "latest open"
        // = the NEW session and rewrote its timestamps. With targeting it must be a no-op
        // idempotent hit against the OLD entry and leave the live session alone (BUG 3).
        $meta = $this->service->stopWithMeta([
            'time_entry_id' => $oldEntry->id,
            'started_at' => now()->subHours(5)->toISOString(),
            'ended_at' => now()->subHours(4)->toISOString(),
        ]);

        $this->assertTrue($meta['already_stopped']);
        $this->assertEquals($oldEntry->id, $meta['entry']->id);

        // The new session is untouched: still open and still the live Redis target.
        $this->assertNull($newEntry->fresh()->ended_at);
        $redis = json_decode(Redis::get("timer:{$this->user->id}"), true);
        $this->assertEquals($newEntry->id, $redis['entry_id']);
    }

    public function test_stop_unknown_entry_id_throws(): void
    {
        $this->service->start([]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Target time entry not found.');

        $this->service->stop(['time_entry_id' => \Illuminate\Support\Str::uuid()->toString()]);
    }

    public function test_stop_targeting_already_closed_entry_is_idempotent(): void
    {
        $closed = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);

        $meta = $this->service->stopWithMeta(['time_entry_id' => $closed->id]);

        $this->assertTrue($meta['already_stopped']);
        $this->assertEquals($closed->id, $meta['entry']->id);
        $this->assertEquals(3600, $meta['entry']->duration_seconds);
    }

    // ─── BUG 3: duplicate start returns existing entry (200), never a 500 ────

    public function test_duplicate_open_timer_returns_existing_entry_not_500(): void
    {
        // Pre-existing OPEN entry holding the one-open-timer slot.
        $open = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(10),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);

        // Redis points at a DIFFERENT, already-closed entry, so the auto-stop guard
        // finds nothing to close and falls through to create — tripping the unique index.
        $closed = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);
        Redis::setex("timer:{$this->user->id}", 2592000, json_encode([
            'entry_id' => $closed->id,
            'started_at' => $closed->started_at->toISOString(),
            'project_id' => null,
            'task_id' => null,
        ]));

        $meta = $this->service->startWithMeta([]);

        // Resolved gracefully: the existing open entry comes back as an idempotent hit.
        $this->assertTrue($meta['is_existing']);
        $this->assertEquals($open->id, $meta['entry']->id);

        // Still exactly one open entry — no duplicate was created.
        $openCount = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $this->user->id)
            ->whereNull('ended_at')
            ->count();
        $this->assertEquals(1, $openCount);

        // Redis was repaired to point at the real open session.
        $redis = json_decode(Redis::get("timer:{$this->user->id}"), true);
        $this->assertEquals($open->id, $redis['entry_id']);
    }

    public function test_start_endpoint_returns_200_on_duplicate_open_timer(): void
    {
        $open = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(10),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);
        $closed = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
            'type' => 'tracked',
        ]);
        Redis::setex("timer:{$this->user->id}", 2592000, json_encode([
            'entry_id' => $closed->id,
            'started_at' => $closed->started_at->toISOString(),
            'project_id' => null,
            'task_id' => null,
        ]));

        $response = $this->postJson('/api/v1/timer/start');

        // Idempotent hit -> 200 (not 201, and absolutely not 500).
        $response->assertStatus(200)
            ->assertJsonPath('entry.id', $open->id);
    }

    // ─── BUG 3: idempotency scoped to OPEN entries ──────────────────────────

    public function test_idempotency_key_returns_open_entry(): void
    {
        $key = \Illuminate\Support\Str::uuid()->toString();

        $first = $this->service->startWithMeta(['idempotency_key' => $key]);
        $this->assertFalse($first['is_existing']);

        // Same key, same open session -> idempotent hit.
        $second = $this->service->startWithMeta(['idempotency_key' => $key]);
        $this->assertTrue($second['is_existing']);
        $this->assertEquals($first['entry']->id, $second['entry']->id);
    }

    public function test_idempotency_key_does_not_resurrect_closed_entry(): void
    {
        $key = \Illuminate\Support\Str::uuid()->toString();

        // Start + stop a session under this key — the entry is now CLOSED.
        $first = $this->service->start(['idempotency_key' => $key]);
        $this->service->stop(['time_entry_id' => $first->id]);
        Redis::flushdb(); // simulate the live key being gone

        // Re-using the key must NOT hand back the dead closed entry as a live session;
        // it must start a fresh OPEN timer.
        $meta = $this->service->startWithMeta(['idempotency_key' => $key]);

        $this->assertFalse($meta['is_existing'], 'A closed entry was resurrected as a live session.');
        $this->assertNotEquals($first->id, $meta['entry']->id);
        $this->assertNull($meta['entry']->ended_at);
    }

    public function test_status_falls_back_to_db_when_redis_key_missing(): void
    {
        $entry = $this->service->start([]);
        $startedAt = $entry->started_at->copy();

        // Advance the clock so elapsed is deterministically non-zero. elapsed_seconds is
        // whole seconds (fractional seconds are truncated by design), so a start→status
        // in the same tick would legitimately report 0 — travel makes the assertion below
        // meaningful without depending on wall-clock timing.
        $this->travel(5)->seconds();

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

        $this->assertNotNull(Redis::get("timer:{$this->user->id}"));
    }

    public function test_pause_freezes_elapsed_and_resume_restores_running(): void
    {
        $entry = $this->service->start([]);
        $this->travel(120)->seconds();

        $paused = $this->service->pause(['pause_reason' => 'idle']);
        $this->assertEquals($entry->id, $paused->id);

        $statusPaused = $this->service->status();
        $this->assertSame('paused', $statusPaused['state']);
        $this->assertFalse($statusPaused['running']);
        $this->assertTrue($statusPaused['paused']);
        $elapsedWhilePaused = $statusPaused['elapsed_seconds'];

        $this->travel(300)->seconds();
        $statusStillPaused = $this->service->status();
        $this->assertSame($elapsedWhilePaused, $statusStillPaused['elapsed_seconds']);

        $resumed = $this->service->resume();
        $this->assertEquals($entry->id, $resumed->id);

        $statusRunning = $this->service->status();
        $this->assertSame('running', $statusRunning['state']);
        $this->assertTrue($statusRunning['running']);
        $this->assertFalse($statusRunning['paused']);
        $this->assertGreaterThan($elapsedWhilePaused, $statusRunning['elapsed_seconds']);
    }
}
