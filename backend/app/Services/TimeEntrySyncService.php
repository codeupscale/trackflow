<?php

namespace App\Services;

use App\Events\TimerStarted;
use App\Events\TimerStopped;
use App\Models\ActivityLog;
use App\Models\Project;
use App\Models\Scopes\GlobalOrganizationScope;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Concerns\HandlesTimeEntryState;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * One-way desktop -> server sync for tracked time.
 *
 * The desktop agent owns every `type = 'tracked'` entry. It records sessions in local
 * SQLite, mutating them freely and offline (start, stop, project switch, idle
 * discard/reassign, midnight split), and pushes the result here as an UPSERT keyed on a
 * client-generated UUID stored in `idempotency_key`.
 *
 * The server is a REPLICA of that local state, not a peer. It does not negotiate: for a
 * newer revision the client's values win outright, including moving `ended_at` BACKWARD
 * (that is exactly what an idle-discard is). This one-directional authority is what
 * removes the entire class of reconcile bugs the previous start/stop RPC design produced
 * — there is only ever one writer.
 *
 * Ordering guarantee this class depends on: within a batch, CLOSED sessions are applied
 * before the single OPEN one. An offline project switch arrives as "close A, open B";
 * applying B first would collide with A on the `idx_one_active_timer_per_user` partial
 * unique index.
 */
class TimeEntrySyncService
{
    use HandlesTimeEntryState;

    /**
     * Result codes returned per session. `ok` means the row is durably stored at the
     * given revision and the agent may stop retrying it. `rejected` is reserved for
     * input the server can never accept (an unparseable or out-of-window clock, or an
     * entry owned by someone else) — the agent KEEPS those rows rather than deleting
     * them, so nothing is ever silently discarded.
     */
    public const STATUS_OK = 'ok';
    public const STATUS_REJECTED = 'rejected';

    /**
     * Apply a batch of client sessions.
     *
     * Every session is processed independently: one bad row never fails the batch, or a
     * single corrupt timestamp on a month-old session would block every good session
     * behind it forever.
     *
     * @param  array<int, array<string, mixed>>  $sessions
     * @return array<int, array<string, mixed>> one result per input session, same order
     */
    public function sync(array $sessions, User $user): array
    {
        // CLOSED first, then the single OPEN one — see the class docblock. `usort` is
        // stable enough here because we only need the two-way partition, and we restore
        // the caller's order before returning.
        $indexed = [];
        foreach ($sessions as $i => $session) {
            $indexed[] = ['index' => $i, 'session' => $session];
        }
        usort($indexed, function ($a, $b) {
            $aOpen = empty($a['session']['ended_at']) ? 1 : 0;
            $bOpen = empty($b['session']['ended_at']) ? 1 : 0;
            if ($aOpen !== $bOpen) {
                return $aOpen <=> $bOpen;
            }

            return $a['index'] <=> $b['index'];
        });

        $results = [];
        $openEntryId = null;

        foreach ($indexed as $item) {
            $session = $item['session'];
            $uuid = (string) ($session['uuid'] ?? '');

            try {
                $result = $this->upsertSession($user, $session);
            } catch (\InvalidArgumentException $e) {
                // Bad clock / reversed interval. Permanent for this payload, but the
                // agent retains the row so a human can still recover the time.
                $result = [
                    'uuid' => $uuid,
                    'status' => self::STATUS_REJECTED,
                    'code' => 'invalid_timestamp',
                    'message' => $e->getMessage(),
                ];
            } catch (\Throwable $e) {
                // Unexpected failure — report as rejected WITHOUT a permanent code so
                // the agent keeps retrying rather than treating it as terminal.
                Log::warning('[TimeEntrySync] Session upsert failed', [
                    'uuid' => $uuid,
                    'user_id' => $user->id,
                    'error' => $e->getMessage(),
                ]);
                $result = [
                    'uuid' => $uuid,
                    'status' => self::STATUS_REJECTED,
                    'code' => 'server_error',
                    'message' => 'Could not be stored; will retry.',
                ];
            }

            if ($result['status'] === self::STATUS_OK && empty($result['ended_at'])) {
                $openEntryId = $result['time_entry_id'];
            }

            $results[$item['index']] = $result;
        }

        ksort($results);

        $this->syncRedisTimerKey($user, $openEntryId);

        return array_values($results);
    }

    /**
     * Upsert a single session.
     *
     * @return array<string, mixed>
     *
     * @throws \InvalidArgumentException on an unusable client timestamp
     */
    private function upsertSession(User $user, array $session): array
    {
        $uuid = (string) $session['uuid'];
        $revision = (int) $session['revision'];

        $startedAt = $this->parseClientTimestamp((string) $session['started_at'], 'started_at');
        $endedAt = ! empty($session['ended_at'])
            ? $this->parseClientTimestamp((string) $session['ended_at'], 'ended_at')
            : null;

        if ($endedAt !== null && $endedAt->lt($startedAt)) {
            throw new \InvalidArgumentException('ended_at must be on or after started_at.');
        }

        // A project the user has lost access to (unassigned, archived, deleted) must NOT
        // cost them the time. Store the entry with a null project and tell the agent why,
        // instead of 422-ing the row into oblivion.
        [$projectId, $warning] = $this->resolveProject($user, $session['project_id'] ?? null);

        return DB::transaction(function () use ($user, $uuid, $revision, $startedAt, $endedAt, $projectId, $warning, $session) {
            $existing = TimeEntry::withoutGlobalScope(GlobalOrganizationScope::class)
                ->where('organization_id', $user->organization_id)
                ->where('idempotency_key', $uuid)
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                // TENANT/OWNER GUARD: the uuid is client-supplied, so a caller could try
                // to claim a colleague's entry by guessing it. Org scoping alone is not
                // enough — both rows live in the same organization.
                if ($existing->user_id !== $user->id) {
                    return [
                        'uuid' => $uuid,
                        'status' => self::STATUS_REJECTED,
                        'code' => 'owned_by_another_user',
                        'message' => 'This session id belongs to a different user.',
                    ];
                }

                // STALE GUARD: a replayed or out-of-order push is a no-op as far as the
                // entry's DATA goes. Revision — not wall-clock time, which we cannot
                // trust from a client — is the sole ordering authority.
                if ($existing->client_revision !== null && $revision <= $existing->client_revision) {
                    // ... but it is NOT a no-op for liveness. The agent re-sends its live
                    // session on every cycle precisely so we know it is still alive, and
                    // that push carries an unchanged revision. Stamping client_synced_at
                    // here is what keeps CleanupStaleEntries and the login-time
                    // stale-close from force-closing a perfectly healthy session that
                    // simply had nothing new to report.
                    $existing->forceFill(['client_synced_at' => now()])->save();

                    return $this->describe($existing->refresh(), $warning, alreadyCurrent: true);
                }

                return $this->applyUpdate($existing, $startedAt, $endedAt, $projectId, $revision, $warning, $session);
            }

            return $this->applyInsert($user, $uuid, $startedAt, $endedAt, $projectId, $revision, $warning, $session);
        });
    }

    /**
     * Update an entry the agent has already synced at least once.
     */
    private function applyUpdate(
        TimeEntry $entry,
        Carbon $startedAt,
        ?Carbon $endedAt,
        ?string $projectId,
        int $revision,
        ?string $warning,
        array $session
    ): array {
        $wasOpen = $entry->ended_at === null;

        $attributes = [
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
            'duration_seconds' => $endedAt ? $this->computeDuration($startedAt, $endedAt) : null,
            'project_id' => $projectId,
            'task_id' => $session['task_id'] ?? $entry->task_id,
            'client_revision' => $revision,
            'client_synced_at' => now(),
        ];

        // Finalize the score from ActivityLog ground truth at the moment the entry
        // closes. While it stays open the running score is left alone — heartbeats are
        // still arriving and would be averaged against an incomplete set.
        if ($endedAt !== null) {
            $finalScore = $this->computeFinalActivityScore($entry->id);
            $attributes['activity_score'] = $finalScore ?? $entry->activity_score ?? 0;
        }

        $entry->update($attributes);
        $entry->refresh();

        // A session that was open and is now closed is a genuine stop. Re-pushing an
        // already-closed session (a later revision correcting its boundary) also
        // broadcasts, so dashboards converge on the corrected value.
        if ($endedAt !== null) {
            TimerStopped::dispatch($entry);
        }

        return $this->describe($entry, $warning, wasOpen: $wasOpen);
    }

    /**
     * Create an entry the server has never seen.
     */
    private function applyInsert(
        User $user,
        string $uuid,
        Carbon $startedAt,
        ?Carbon $endedAt,
        ?string $projectId,
        int $revision,
        ?string $warning,
        array $session
    ): array {
        // A new OPEN session cannot coexist with another open entry for the same user —
        // `idx_one_active_timer_per_user` enforces that. Any other open entry is by
        // definition stale (the agent is the only writer, and it just told us which
        // session is live), so close it at its last known activity rather than letting
        // the insert blow up on a 23505.
        if ($endedAt === null) {
            $this->closeOtherOpenEntries($user, exceptIdempotencyKey: $uuid);
        }

        $entry = TimeEntry::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'project_id' => $projectId,
            'task_id' => $session['task_id'] ?? null,
            'notes' => $session['notes'] ?? null,
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
            'duration_seconds' => $endedAt ? $this->computeDuration($startedAt, $endedAt) : null,
            'type' => 'tracked',
            'idempotency_key' => $uuid,
            'client_revision' => $revision,
            'client_synced_at' => now(),
        ]);

        if ($endedAt === null) {
            // Only a genuinely new LIVE session is a "start". A backfilled closed session
            // from last week must NOT fire TimerStarted — AutoCheckInOnTimerStart would
            // clock the user in for TODAY on the strength of last week's work.
            TimerStarted::dispatch($entry);
        } else {
            TimerStopped::dispatch($entry);
        }

        return $this->describe($entry, $warning, wasOpen: false);
    }

    /**
     * Close any OPEN entry for this user other than the one being opened, at its last
     * known activity: the newest heartbeat, else the last successful agent sync, else
     * its own start (a zero-length close, which counts no dead time).
     */
    private function closeOtherOpenEntries(User $user, string $exceptIdempotencyKey): void
    {
        $stale = TimeEntry::withoutGlobalScope(GlobalOrganizationScope::class)
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->whereNull('ended_at')
            ->whereNull('deleted_at')
            ->where(function ($q) use ($exceptIdempotencyKey) {
                $q->whereNull('idempotency_key')
                    ->orWhere('idempotency_key', '!=', $exceptIdempotencyKey);
            })
            ->lockForUpdate()
            ->get();

        foreach ($stale as $entry) {
            $lastHeartbeat = ActivityLog::where('time_entry_id', $entry->id)->max('logged_at');

            $endedAt = $lastHeartbeat ? Carbon::parse($lastHeartbeat) : ($entry->client_synced_at ?? $entry->started_at);
            if ($endedAt->lt($entry->started_at)) {
                $endedAt = $entry->started_at->copy();
            }

            $finalScore = $this->computeFinalActivityScore($entry->id);

            $entry->update([
                'ended_at' => $endedAt,
                'duration_seconds' => $this->computeDuration($entry->started_at, $endedAt),
                'activity_score' => $finalScore ?? $entry->activity_score ?? 0,
            ]);

            Log::info('[TimeEntrySync] Closed stale open entry superseded by a newer session', [
                'entry_id' => $entry->id,
                'user_id' => $user->id,
                'ended_at' => $endedAt->toISOString(),
            ]);

            TimerStopped::dispatch($entry->fresh());
        }
    }

    /**
     * Resolve the client's project id to one the user may actually track against.
     *
     * @return array{0: ?string, 1: ?string} [project_id, warning]
     */
    private function resolveProject(User $user, ?string $projectId): array
    {
        if (empty($projectId)) {
            return [null, null];
        }

        $project = Project::withoutGlobalScope(GlobalOrganizationScope::class)
            ->where('organization_id', $user->organization_id)
            ->where('id', $projectId)
            ->first();

        if (! $project) {
            return [null, 'project_not_found'];
        }

        if (! $project->isAssignedTo($user)) {
            return [null, 'project_unassigned'];
        }

        return [$project->id, null];
    }

    /**
     * Maintain the per-user Redis timer key so `GET /timer/status` — and therefore the
     * WEB dashboard's live-tracking indicator — reflects what the agent just reported.
     * The desktop never reads this key; it exists purely for other surfaces.
     */
    private function syncRedisTimerKey(User $user, ?string $openEntryId): void
    {
        $redisKey = "timer:{$user->id}";

        try {
            if ($openEntryId !== null) {
                $entry = TimeEntry::withoutGlobalScope(GlobalOrganizationScope::class)
                    ->where('id', $openEntryId)
                    ->first();

                if ($entry && $entry->ended_at === null) {
                    Redis::setex($redisKey, 2592000, $this->encodeRedisTimerState($entry, 'running'));

                    return;
                }
            }

            // No live session in this batch. Only clear the key if it points at an entry
            // that is now closed — never wipe a key belonging to a session we did not
            // touch in this request.
            $meta = $this->getRedisTimerMeta($redisKey);
            if ($meta === null || empty($meta['entry_id'])) {
                return;
            }

            $stillOpen = TimeEntry::withoutGlobalScope(GlobalOrganizationScope::class)
                ->where('id', $meta['entry_id'])
                ->whereNull('ended_at')
                ->exists();

            if (! $stillOpen) {
                Redis::del($redisKey);
            }
        } catch (\Throwable $e) {
            // Redis is a cache for the dashboard's convenience, never the source of
            // truth. A failure here must not fail a sync that already committed.
            Log::warning('[TimeEntrySync] Redis timer key update failed', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Build the per-session ack. `duration_seconds` is echoed so the agent can compare
     * against its local value and surface any server-side clamping before it purges the
     * local row.
     *
     * @return array<string, mixed>
     */
    private function describe(TimeEntry $entry, ?string $warning, bool $wasOpen = false, bool $alreadyCurrent = false): array
    {
        $result = [
            'uuid' => $entry->idempotency_key,
            'status' => self::STATUS_OK,
            'time_entry_id' => $entry->id,
            'revision' => $entry->client_revision,
            'started_at' => $entry->started_at?->toISOString(),
            'ended_at' => $entry->ended_at?->toISOString(),
            'duration_seconds' => $entry->duration_seconds,
        ];

        if ($warning !== null) {
            $result['warning'] = $warning;
        }
        if ($alreadyCurrent) {
            $result['already_current'] = true;
        }
        if ($wasOpen && $entry->ended_at !== null) {
            $result['closed'] = true;
        }

        return $result;
    }
}
