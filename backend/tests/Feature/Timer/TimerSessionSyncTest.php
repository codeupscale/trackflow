<?php

namespace Tests\Feature\Timer;

use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Events\TimerStopped;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * POST /api/v1/timer/sessions/sync — the ONLY write path for tracked time.
 *
 * These exercise the REAL Redis (test env points at 127.0.0.1:6380) and the REAL
 * partial unique index idx_one_active_timer_per_user, because the whole point of the
 * offline-first design is that the desktop can push any local state at any time and
 * the server converges without duplicating, truncating, or losing work.
 */
class TimerSessionSyncTest extends TestCase
{
    private const URL = '/api/v1/timer/sessions/sync';

    private Organization $org;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        // Freeze the clock. Durations here are asserted to the second, and two separate
        // now() calls in the same test drift by microseconds — enough to turn an exact
        // 3000s into 2999s and make the suite intermittently red for no real reason.
        Carbon::setTestNow(Carbon::parse('2026-07-30 12:00:00', 'UTC'));

        $this->org = $this->createOrganization();
        $this->user = $this->createUser($this->org, 'employee');
        $this->actingAs($this->user, 'sanctum');
        Redis::flushdb();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        Redis::flushdb();
        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'uuid' => (string) Str::uuid(),
            'revision' => 1,
            'started_at' => now()->subHour()->toISOString(),
            'ended_at' => null,
            'project_id' => null,
        ], $overrides);
    }

    private function assignedProject(): Project
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->user->id,
        ]);
        $project->members()->attach($this->user->id);

        return $project;
    }

    // ─── Create ──────────────────────────────────────────────────────────────

    public function test_creates_entry_on_first_sync(): void
    {
        $session = $this->payload([
            'started_at' => now()->subMinutes(30)->toISOString(),
            'ended_at' => now()->subMinutes(10)->toISOString(),
        ]);

        $response = $this->postJson(self::URL, ['sessions' => [$session]]);

        $response->assertOk()
            ->assertJsonPath('results.0.status', 'ok')
            ->assertJsonPath('results.0.uuid', $session['uuid'])
            ->assertJsonPath('results.0.duration_seconds', 1200)
            ->assertJsonPath('meta.accepted', 1);

        $this->assertDatabaseHas('time_entries', [
            'idempotency_key' => $session['uuid'],
            'user_id' => $this->user->id,
            'type' => 'tracked',
            'duration_seconds' => 1200,
            'client_revision' => 1,
        ]);
    }

    public function test_open_session_creates_open_entry_and_sets_redis(): void
    {
        $session = $this->payload();

        $this->postJson(self::URL, ['sessions' => [$session]])
            ->assertOk()
            ->assertJsonPath('results.0.ended_at', null);

        $entry = TimeEntry::where('idempotency_key', $session['uuid'])->firstOrFail();
        $this->assertNull($entry->ended_at);
        $this->assertNull($entry->duration_seconds);

        // The web dashboard's live-tracking indicator reads GET /timer/status, which is
        // backed by this key. If the sync path stops maintaining it, the desktop tracks
        // happily while the dashboard shows the user as idle.
        $redis = json_decode(Redis::get("timer:{$this->user->id}"), true);
        $this->assertSame($entry->id, $redis['entry_id']);
        $this->assertSame('running', $redis['state']);

        $this->getJson('/api/v1/timer/status')
            ->assertOk()
            ->assertJsonPath('running', true)
            ->assertJsonPath('entry.id', $entry->id);
    }

    // ─── Idempotency / ordering ──────────────────────────────────────────────

    public function test_replaying_same_revision_is_a_no_op(): void
    {
        $session = $this->payload([
            'ended_at' => now()->subMinutes(10)->toISOString(),
        ]);

        $this->postJson(self::URL, ['sessions' => [$session]])->assertOk();
        $this->postJson(self::URL, ['sessions' => [$session]])
            ->assertOk()
            ->assertJsonPath('results.0.status', 'ok')
            ->assertJsonPath('results.0.already_current', true);

        // Exactly one entry — a replay must never duplicate the work.
        $this->assertSame(1, TimeEntry::where('idempotency_key', $session['uuid'])->count());
    }

    public function test_stale_revision_does_not_overwrite_newer_data(): void
    {
        $uuid = (string) Str::uuid();
        $newEnd = now()->subMinutes(5);

        // Revision 2 lands first (the agent retried out of order).
        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 2,
            'started_at' => now()->subHour()->toISOString(),
            'ended_at' => $newEnd->toISOString(),
        ])]])->assertOk();

        // Revision 1 arrives late carrying an older, shorter boundary.
        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 1,
            'started_at' => now()->subHour()->toISOString(),
            'ended_at' => now()->subMinutes(50)->toISOString(),
        ])]])->assertOk()->assertJsonPath('results.0.already_current', true);

        $entry = TimeEntry::where('idempotency_key', $uuid)->firstOrFail();
        $this->assertEqualsWithDelta($newEnd->timestamp, $entry->ended_at->timestamp, 2);
        $this->assertSame(2, $entry->client_revision);
    }

    public function test_unchanged_live_session_still_refreshes_liveness(): void
    {
        $session = $this->payload();
        $this->postJson(self::URL, ['sessions' => [$session]])->assertOk();

        // Backdate the liveness marker as if the agent had been quiet for hours.
        TimeEntry::where('idempotency_key', $session['uuid'])
            ->update(['client_synced_at' => now()->subHours(9)]);

        // The agent re-sends the live session unchanged. This carries no new data, but
        // it IS proof of life — CleanupStaleEntries and the login-time stale-close both
        // key off client_synced_at, and would force-close a healthy session without it.
        $this->postJson(self::URL, ['sessions' => [$session]])->assertOk();

        $entry = TimeEntry::where('idempotency_key', $session['uuid'])->firstOrFail();
        $this->assertTrue(
            $entry->client_synced_at->gt(now()->subMinute()),
            'An unchanged push of the live session must still refresh client_synced_at.'
        );
    }

    // ─── Transitions ─────────────────────────────────────────────────────────

    public function test_open_session_closes_on_later_revision(): void
    {
        $uuid = (string) Str::uuid();
        $startedAt = now()->subHour();

        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 1,
            'started_at' => $startedAt->toISOString(),
        ])]])->assertOk();

        $endedAt = now()->subMinutes(2);
        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 2,
            'started_at' => $startedAt->toISOString(),
            'ended_at' => $endedAt->toISOString(),
        ])]])->assertOk()->assertJsonPath('results.0.closed', true);

        $entry = TimeEntry::where('idempotency_key', $uuid)->firstOrFail();
        $this->assertNotNull($entry->ended_at);
        $this->assertSame(1, TimeEntry::where('user_id', $this->user->id)->count());

        // Redis must be cleared, or the dashboard shows a phantom running timer.
        $this->assertNull(Redis::get("timer:{$this->user->id}"));
    }

    public function test_ended_at_may_move_backward_for_an_idle_discard(): void
    {
        $uuid = (string) Str::uuid();
        $startedAt = now()->subHours(2);

        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 1,
            'started_at' => $startedAt->toISOString(),
            'ended_at' => now()->subMinutes(10)->toISOString(),
        ])]])->assertOk();

        // The user discarded idle time: the session legitimately gets SHORTER. The client
        // is authoritative, so a monotonic "never shrink ended_at" guard would be wrong
        // here — it would bill the discarded idle time anyway.
        $trimmedEnd = now()->subMinutes(40);
        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 2,
            'started_at' => $startedAt->toISOString(),
            'ended_at' => $trimmedEnd->toISOString(),
        ])]])->assertOk();

        $entry = TimeEntry::where('idempotency_key', $uuid)->firstOrFail();
        $this->assertEqualsWithDelta($trimmedEnd->timestamp, $entry->ended_at->timestamp, 2);
    }

    public function test_extends_an_entry_cleanup_closed_early(): void
    {
        $uuid = (string) Str::uuid();
        $startedAt = now()->subHours(3);

        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 1,
            'started_at' => $startedAt->toISOString(),
        ])]])->assertOk();

        // Simulate timer:cleanup-stale force-closing the entry at its last heartbeat
        // while the desktop kept tracking offline.
        $entry = TimeEntry::where('idempotency_key', $uuid)->firstOrFail();
        $entry->update([
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
        ]);

        // The agent finally flushes the REAL stop, an hour later than cleanup guessed.
        $realEnd = now()->subMinutes(30);
        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 2,
            'started_at' => $startedAt->toISOString(),
            'ended_at' => $realEnd->toISOString(),
        ])]])->assertOk();

        $entry->refresh();
        $this->assertEqualsWithDelta($realEnd->timestamp, $entry->ended_at->timestamp, 2);
        $this->assertEqualsWithDelta(9000, $entry->duration_seconds, 5);
    }

    public function test_new_open_session_closes_a_previous_orphaned_open_entry(): void
    {
        // An entry left open by a killed agent, with a heartbeat marking last activity.
        $orphan = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(5),
            'type' => 'tracked',
            'idempotency_key' => (string) Str::uuid(),
        ]);
        $lastHeartbeat = now()->subHours(4);
        ActivityLog::create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'time_entry_id' => $orphan->id,
            'logged_at' => $lastHeartbeat,
            'keyboard_events' => 10,
            'mouse_events' => 10,
        ]);

        // A fresh live session arrives. Without closing the orphan this trips
        // idx_one_active_timer_per_user and the whole sync fails.
        $this->postJson(self::URL, ['sessions' => [$this->payload()]])
            ->assertOk()
            ->assertJsonPath('results.0.status', 'ok');

        $orphan->refresh();
        $this->assertNotNull($orphan->ended_at, 'Orphaned open entry was not reclaimed.');
        // Closed AT the last heartbeat — the dead hours after the agent died are not billed.
        $this->assertEqualsWithDelta($lastHeartbeat->timestamp, $orphan->ended_at->timestamp, 2);
    }

    public function test_offline_project_switch_closes_then_opens_in_one_batch(): void
    {
        $a = $this->assignedProject();
        $b = $this->assignedProject();
        $switchAt = now()->subMinutes(20);

        // The agent sends the OPEN session first in the payload; the server must still
        // apply the CLOSE before it, or the two collide on the one-open-timer index.
        $response = $this->postJson(self::URL, ['sessions' => [
            $this->payload([
                'revision' => 1,
                'project_id' => $b->id,
                'started_at' => $switchAt->toISOString(),
                'ended_at' => null,
            ]),
            $this->payload([
                'revision' => 2,
                'project_id' => $a->id,
                'started_at' => now()->subHour()->toISOString(),
                'ended_at' => $switchAt->toISOString(),
            ]),
        ]]);

        $response->assertOk()->assertJsonPath('meta.accepted', 2);

        $this->assertSame(1, TimeEntry::where('user_id', $this->user->id)->whereNull('ended_at')->count());
        $open = TimeEntry::where('user_id', $this->user->id)->whereNull('ended_at')->firstOrFail();
        $this->assertSame($b->id, $open->project_id);
    }

    // ─── Never discard time ──────────────────────────────────────────────────

    public function test_unassigned_project_degrades_to_null_instead_of_rejecting(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->user->id,
        ]);
        // Deliberately NOT a member.

        $session = $this->payload([
            'project_id' => $project->id,
            'ended_at' => now()->subMinutes(10)->toISOString(),
        ]);

        $this->postJson(self::URL, ['sessions' => [$session]])
            ->assertOk()
            ->assertJsonPath('results.0.status', 'ok')
            ->assertJsonPath('results.0.warning', 'project_unassigned');

        // The TIME survives — only the project attribution is dropped. Rejecting the row
        // would destroy work the user actually did.
        $entry = TimeEntry::where('idempotency_key', $session['uuid'])->firstOrFail();
        $this->assertNull($entry->project_id);
        $this->assertSame(3000, $entry->duration_seconds);
    }

    public function test_accepts_a_session_far_older_than_the_legacy_24h_window(): void
    {
        // This is the case that was REJECTED outright before the refactor: a laptop that
        // tracked offline over a long break had every session refused on reconnect.
        $session = $this->payload([
            'started_at' => now()->subDays(9)->toISOString(),
            'ended_at' => now()->subDays(9)->addHours(3)->toISOString(),
        ]);

        $this->postJson(self::URL, ['sessions' => [$session]])
            ->assertOk()
            ->assertJsonPath('results.0.status', 'ok')
            ->assertJsonPath('results.0.duration_seconds', 10800);
    }

    public function test_one_bad_session_does_not_block_the_rest_of_the_batch(): void
    {
        $good = $this->payload(['ended_at' => now()->subMinutes(10)->toISOString()]);
        $bad = $this->payload([
            'started_at' => now()->subMinutes(10)->toISOString(),
            'ended_at' => now()->subMinutes(40)->toISOString(), // ends before it starts
        ]);

        $response = $this->postJson(self::URL, ['sessions' => [$bad, $good]]);

        $response->assertOk()
            ->assertJsonPath('results.0.status', 'rejected')
            ->assertJsonPath('results.0.code', 'invalid_timestamp')
            ->assertJsonPath('results.1.status', 'ok');

        $this->assertDatabaseHas('time_entries', ['idempotency_key' => $good['uuid']]);
    }

    public function test_results_are_returned_in_request_order(): void
    {
        // The agent matches acks to rows positionally as well as by uuid; the closed-first
        // internal reordering must not leak into the response.
        $open = $this->payload();
        $closed = $this->payload(['ended_at' => now()->subMinutes(10)->toISOString()]);

        $this->postJson(self::URL, ['sessions' => [$open, $closed]])
            ->assertOk()
            ->assertJsonPath('results.0.uuid', $open['uuid'])
            ->assertJsonPath('results.1.uuid', $closed['uuid']);
    }

    public function test_a_broadcast_failure_never_loses_the_session(): void
    {
        // TimerStarted/TimerStopped are ShouldBroadcastNow, so dispatching them talks to
        // Reverb synchronously over HTTP. Before this was isolated, a websocket outage
        // threw inside the enclosing transaction — rolling back the write and failing the
        // whole sync. A Reverb restart would then have silently stopped ALL tracked time
        // from uploading, which is the exact failure this architecture exists to prevent.
        Event::listen(TimerStopped::class, function () {
            throw new \RuntimeException('Pusher error: cURL error 7: connection refused');
        });

        $session = $this->payload(['ended_at' => now()->subMinutes(10)->toISOString()]);

        $this->postJson(self::URL, ['sessions' => [$session]])
            ->assertOk()
            ->assertJsonPath('results.0.status', 'ok');

        $this->assertDatabaseHas('time_entries', [
            'idempotency_key' => $session['uuid'],
            'duration_seconds' => 3000,
        ]);
    }

    // ─── Isolation & validation ──────────────────────────────────────────────

    public function test_cannot_claim_an_entry_belonging_to_another_user(): void
    {
        $colleague = $this->createUser($this->org, 'employee');
        $uuid = (string) Str::uuid();

        $theirs = TimeEntry::create([
            'organization_id' => $this->org->id,
            'user_id' => $colleague->id,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
            'type' => 'tracked',
            'idempotency_key' => $uuid,
            'client_revision' => 1,
        ]);

        // Same org, so org scoping alone would let this through — the uuid is
        // client-supplied and therefore guessable/forgeable.
        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 2,
            'started_at' => now()->subHour()->toISOString(),
            'ended_at' => now()->toISOString(),
        ])]])
            ->assertOk()
            ->assertJsonPath('results.0.status', 'rejected')
            ->assertJsonPath('results.0.code', 'owned_by_another_user');

        $theirs->refresh();
        $this->assertSame($colleague->id, $theirs->user_id);
        $this->assertSame(3600, $theirs->duration_seconds);
    }

    public function test_same_uuid_in_a_different_org_creates_a_separate_entry(): void
    {
        $uuid = (string) Str::uuid();
        $otherOrg = $this->createOrganization();
        $otherUser = $this->createUser($otherOrg, 'employee');

        TimeEntry::create([
            'organization_id' => $otherOrg->id,
            'user_id' => $otherUser->id,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
            'type' => 'tracked',
            'idempotency_key' => $uuid,
            'client_revision' => 5,
        ]);

        $this->postJson(self::URL, ['sessions' => [$this->payload([
            'uuid' => $uuid,
            'revision' => 1,
            'ended_at' => now()->subMinutes(10)->toISOString(),
        ])]])->assertOk()->assertJsonPath('results.0.status', 'ok');

        $this->assertSame(2, TimeEntry::withoutGlobalScopes()->where('idempotency_key', $uuid)->count());
    }

    public function test_rejects_more_than_one_open_session(): void
    {
        $this->postJson(self::URL, ['sessions' => [$this->payload(), $this->payload()]])
            ->assertStatus(422)
            ->assertJsonValidationErrors('sessions');
    }

    public function test_rejects_duplicate_uuid_within_a_batch(): void
    {
        $uuid = (string) Str::uuid();

        $this->postJson(self::URL, ['sessions' => [
            $this->payload(['uuid' => $uuid, 'ended_at' => now()->subHour()->toISOString()]),
            $this->payload(['uuid' => $uuid, 'ended_at' => now()->subMinutes(10)->toISOString()]),
        ]])->assertStatus(422)->assertJsonValidationErrors('sessions');
    }

    public function test_rejects_a_batch_over_the_cap(): void
    {
        $sessions = [];
        for ($i = 0; $i < 101; $i++) {
            $sessions[] = $this->payload(['ended_at' => now()->subMinutes(10)->toISOString()]);
        }

        $this->postJson(self::URL, ['sessions' => $sessions])
            ->assertStatus(422)
            ->assertJsonValidationErrors('sessions');
    }

    public function test_requires_authentication(): void
    {
        $this->app['auth']->forgetGuards();

        $this->postJson(self::URL, ['sessions' => [$this->payload()]])->assertStatus(401);
    }

    public function test_legacy_mutation_endpoints_are_gone(): void
    {
        // Force-upgrade: pre-refactor builds must fail loudly rather than silently
        // writing through a second, unreconciled path.
        foreach (['start', 'stop', 'switch', 'pause', 'resume', 'idle'] as $action) {
            $this->postJson("/api/v1/timer/{$action}")->assertStatus(404);
        }
    }
}
