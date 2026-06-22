<?php

namespace App\Services;

use App\Events\TimerStarted;
use App\Events\TimerStopped;
use App\Models\Project;
use App\Models\User;
use App\Models\TimeEntry;
use App\Models\ActivityLog;
use App\Services\AppUsageService;
use Illuminate\Auth\Access\AuthorizationException;
use App\Support\TimezoneAwareDateRange;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

class TimerService
{
    // Redis key pattern: timer:{user_id}
    // Value: JSON {entry_id, started_at, project_id, task_id}
    // TTL: 30 days (2592000 seconds)

    /**
     * Maximum duration (seconds) for any single time entry.
     * 12 hours = 43200 seconds. Prevents runaway timers from corrupting reports.
     */
    private const MAX_ENTRY_DURATION = 43200;

    /**
     * How far in the past an offline-supplied timestamp may legitimately be.
     * 24 hours. A timer started offline should reconcile well within a day;
     * anything older is treated as a bad/corrupt clock and rejected.
     */
    private const MAX_PAST_SKEW = 86400;

    /**
     * How far in the future a client timestamp may be and still be accepted,
     * to tolerate small client/server clock skew. 5 minutes.
     */
    private const MAX_FUTURE_SKEW = 300;

    /**
     * TTL (seconds) for the per-user timer mutex lock.
     *
     * The old 5s TTL could silently expire mid-transaction under load because the
     * critical section includes an unbounded computeFinalActivityScore() query plus
     * a DB transaction. A dropped mutex allows a concurrent start/stop to interleave
     * and create duplicate/clashing sessions (BUG 3). 15s comfortably covers the
     * bounded work while still self-healing if a worker dies holding the lock.
     */
    private const LOCK_TTL = 15;

    /**
     * Parse and validate a client-supplied timestamp against the allowed skew window.
     *
     * - Rejects timestamps more than MAX_FUTURE_SKEW in the future (bad/forward clock).
     * - Rejects timestamps more than MAX_PAST_SKEW in the past (corrupt/backward clock).
     * - Normalises near-future-but-within-skew values back to now() so stored data
     *   never claims a future start.
     *
     * @throws \InvalidArgumentException on an out-of-window timestamp.
     */
    private function parseClientTimestamp(string $raw, string $field): Carbon
    {
        try {
            $ts = Carbon::parse($raw);
        } catch (\Throwable $e) {
            throw new \InvalidArgumentException("{$field} is not a valid timestamp.");
        }

        $now = now();

        if ($ts->gt($now->copy()->addSeconds(self::MAX_FUTURE_SKEW))) {
            throw new \InvalidArgumentException("{$field} cannot be in the future.");
        }

        // Within forward-skew tolerance but still ahead of server "now": clamp to now.
        if ($ts->gt($now)) {
            $ts = $now->copy();
        }

        if ($ts->lt($now->copy()->subSeconds(self::MAX_PAST_SKEW))) {
            throw new \InvalidArgumentException("{$field} is too far in the past.");
        }

        return $ts;
    }

    /**
     * Compute a duration in seconds from a start/end pair with explicit chronology
     * validation. Unlike the old abs()-based math, a reversed interval (end before
     * start) is REJECTED rather than silently turned into a positive bogus duration.
     *
     * @throws \InvalidArgumentException when $endedAt is before $startedAt.
     */
    private function computeDuration(Carbon $startedAt, Carbon $endedAt): int
    {
        $seconds = $startedAt->diffInSeconds($endedAt, false);

        if ($seconds < 0) {
            throw new \InvalidArgumentException('ended_at must be on or after started_at.');
        }

        return min((int) $seconds, self::MAX_ENTRY_DURATION);
    }

    /**
     * Start a timer. Returns the created (or existing idempotent) TimeEntry.
     *
     * Use startWithMeta() when you need to know whether the entry was existing (idempotent hit).
     */
    public function start(array $data): TimeEntry
    {
        $meta = $this->startWithMeta($data);
        return $meta['entry'];
    }

    /**
     * Start a timer. Returns ['entry' => TimeEntry, 'is_existing' => bool].
     * When an idempotency_key matches an open entry, returns the existing one (is_existing=true).
     */
    public function startWithMeta(array $data): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        // Validate optional offline start timestamp up front (rejects bad clocks).
        $overrideStartedAt = null;
        if (! empty($data['started_at'])) {
            $overrideStartedAt = $this->parseClientTimestamp($data['started_at'], 'started_at');
        }

        // Idempotency check — BEFORE lock acquisition (read-only, safe without lock).
        // If the desktop/client sends the same idempotency_key for a start that already
        // succeeded, return the existing OPEN entry instead of creating a duplicate.
        //
        // Scoped to whereNull('ended_at'): a key that maps only to an already-CLOSED
        // entry must NOT be returned as a live session — otherwise the desktop would
        // tick elapsed time against a dead server entry (BUG 3). When the key's only
        // match is closed, we fall through and start a fresh timer.
        if (! empty($data['idempotency_key'])) {
            $idempotent = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('organization_id', $user->organization_id)
                ->where('idempotency_key', $data['idempotency_key'])
                ->whereNull('ended_at')
                ->whereNull('deleted_at')
                ->first();

            if ($idempotent) {
                return ['entry' => $idempotent, 'is_existing' => true];
            }
        }

        // Employees may only start a timer on projects they are assigned to
        if (! empty($data['project_id'] ?? null)) {
            $project = Project::where('organization_id', $user->organization_id)
                ->findOrFail($data['project_id']);
            if (! $project->isAssignedTo($user)) {
                throw new AuthorizationException('You are not assigned to this project.');
            }
        }

        // Atomically acquire lock to prevent race condition
        if (!Redis::set($lockKey, 1, 'EX', self::LOCK_TTL, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            // Duplicate timer guard: if a timer is already running, auto-stop it first.
            // Checks Redis first (fast path), then falls back to DB (catches orphaned entries
            // where Redis key was lost due to the non-transactional Redis::del bug).
            $existing = Redis::get($redisKey);
            if ($existing) {
                $existingData = json_decode($existing, true);
                if ($existingData && !empty($existingData['entry_id'])) {
                    // Auto-stop the existing timer gracefully
                    $existingEntry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                        ->where('id', $existingData['entry_id'])
                        ->where('user_id', $user->id)
                        ->whereNull('ended_at')
                        ->first();

                    if ($existingEntry) {
                        $now = now();
                        // Clock skew guard: ended_at must never be before started_at.
                        // computeDuration() then validates chronology (rejects reversed
                        // intervals) instead of abs()-masking them into a bogus positive.
                        $endedAt = $now->lt($existingEntry->started_at) ? $existingEntry->started_at->copy() : $now;
                        $duration = $this->computeDuration($existingEntry->started_at, $endedAt);
                        $finalScore = $this->computeFinalActivityScore($existingEntry->id);

                        $existingEntry->update([
                            'ended_at' => $endedAt,
                            'duration_seconds' => $duration,
                            'activity_score' => $finalScore ?? $existingEntry->activity_score ?? 0,
                        ]);

                        Redis::del($redisKey);
                        TimerStopped::dispatch($existingEntry);
                    } else {
                        // Redis key is stale (entry already closed or missing) — clean it up
                        Redis::del($redisKey);
                    }
                }
            } else {
                // Redis key missing — check DB for any orphaned open entry.
                // This catches the case where Redis::del fired inside a rolled-back transaction,
                // leaving an open entry in DB with no corresponding Redis key.
                $orphan = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('user_id', $user->id)
                    ->where('organization_id', $user->organization_id)
                    ->whereNull('ended_at')
                    ->whereNull('deleted_at')
                    ->latest('started_at')
                    ->first();

                if ($orphan) {
                    $now = now();
                    $endedAt = $now->lt($orphan->started_at) ? $orphan->started_at->copy() : $now;
                    $duration = $this->computeDuration($orphan->started_at, $endedAt);
                    $finalScore = $this->computeFinalActivityScore($orphan->id);
                    $orphan->update([
                        'ended_at'         => $endedAt,
                        'duration_seconds' => $duration,
                        'activity_score'   => $finalScore ?? $orphan->activity_score ?? 0,
                    ]);
                    TimerStopped::dispatch($orphan);
                }
            }

            // Resolve the start timestamp:
            //   - honor a validated offline `started_at` (BUG 1: offline timers must keep
            //     their real local start, not be stamped at reconcile time);
            //   - otherwise fall back to server now().
            $startedAt = $overrideStartedAt ?? now();

            // Guard the compound (organization_id, idempotency_key) unique index: if this
            // key is already attached to a CLOSED entry (we only fell through because it
            // was not open), persist null instead of colliding on te_org_idempotency_unique.
            $idempotencyKey = $data['idempotency_key'] ?? null;
            if ($idempotencyKey) {
                $keyInUse = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('organization_id', $user->organization_id)
                    ->where('idempotency_key', $idempotencyKey)
                    ->exists();
                if ($keyInUse) {
                    $idempotencyKey = null;
                }
            }

            try {
                // Use DB transaction and set Redis BEFORE committing
                $entry = DB::transaction(function () use ($user, $data, $redisKey, $startedAt, $idempotencyKey) {
                    $entry = TimeEntry::create([
                        'organization_id' => $user->organization_id,
                        'user_id' => $user->id,
                        'project_id' => $data['project_id'] ?? null,
                        'task_id' => $data['task_id'] ?? null,
                        'notes' => $data['notes'] ?? null,
                        'started_at' => $startedAt,
                        'type' => 'tracked',
                        'idempotency_key' => $idempotencyKey,
                    ]);

                    // Set Redis before committing to maintain consistency
                    Redis::setex($redisKey, 2592000, $this->encodeRedisTimerState($entry, 'running'));

                    return $entry;
                });
            } catch (\Illuminate\Database\QueryException $e) {
                // BUG 3: the partial unique index idx_one_active_timer_per_user enforces
                // at most one open timer per user. A concurrent/duplicate start trips
                // SQLSTATE 23505. Resolve gracefully by returning the entry that already
                // holds the open slot — never let it escape as an uncaught HTTP 500.
                $existingOpen = $this->resolveOpenTimerConflict($e, $user, $redisKey);
                if ($existingOpen !== null) {
                    return ['entry' => $existingOpen, 'is_existing' => true];
                }
                throw $e;
            }

            TimerStarted::dispatch($entry);

            return ['entry' => $entry, 'is_existing' => false];
        } finally {
            Redis::del($lockKey);
        }
    }

    /**
     * Resolve a unique-constraint violation raised while opening a timer.
     *
     * Returns the user's existing open TimeEntry when the violation is the
     * one-open-timer-per-user index (SQLSTATE 23505), so the caller can hand that
     * back as a 200 idempotent hit. Returns null for any other QueryException so
     * the caller rethrows.
     */
    private function resolveOpenTimerConflict(\Illuminate\Database\QueryException $e, $user, string $redisKey): ?TimeEntry
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $message = $e->getMessage();

        $isUniqueViolation = $sqlState === '23505';
        $isOpenTimerIndex = str_contains($message, 'idx_one_active_timer_per_user');

        if (! $isUniqueViolation || ! $isOpenTimerIndex) {
            return null;
        }

        $existingOpen = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('organization_id', $user->organization_id)
            ->whereNull('ended_at')
            ->whereNull('deleted_at')
            ->latest('started_at')
            ->first();

        if ($existingOpen) {
            // Repair Redis so the live session is discoverable by status()/stop().
            Redis::setex($redisKey, 2592000, $this->encodeRedisTimerState($existingOpen, 'running'));
        }

        return $existingOpen;
    }

    /**
     * Stop the running timer. Returns the stopped TimeEntry.
     *
     * Use stopWithMeta() when you need to know whether the entry was already stopped.
     *
     * @param array $data Optional: 'time_entry_id' to target a specific entry,
     *                    'started_at'/'ended_at' for offline sync (validated against
     *                    that entry + a skew window), 'idempotency_key' (informational).
     */
    public function stop(array $data = []): TimeEntry
    {
        $meta = $this->stopWithMeta($data);
        return $meta['entry'];
    }

    /**
     * Stop the running timer. Returns ['entry' => TimeEntry, 'already_stopped' => bool].
     *
     * Targeting (BUG 3): when 'time_entry_id' is supplied, the stop is bound to THAT
     * entry — never "the latest open entry". This prevents an old/offline stop whose
     * response was lost from being replayed against a freshly-started session and
     * rewriting its timestamps.
     *
     * @param array $data Optional: 'time_entry_id', 'started_at', 'ended_at', 'idempotency_key'.
     */
    public function stopWithMeta(array $data = []): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        $targetEntryId = $data['time_entry_id'] ?? null;

        // Parse and validate optional offline timestamps against the skew window
        // (rejects future + far-past clocks). Chronology vs the entry is checked later.
        $overrideEndedAt = null;
        $overrideStartedAt = null;

        if (! empty($data['ended_at'])) {
            $overrideEndedAt = $this->parseClientTimestamp($data['ended_at'], 'ended_at');
        }
        if (! empty($data['started_at'])) {
            $overrideStartedAt = $this->parseClientTimestamp($data['started_at'], 'started_at');
        }
        if ($overrideStartedAt && $overrideEndedAt && $overrideEndedAt->lt($overrideStartedAt)) {
            throw new \InvalidArgumentException('ended_at must be on or after started_at.');
        }

        // ── Resolve which entry this stop targets ───────────────────────────────
        // Priority:
        //   1. An explicit time_entry_id (offline reconcile binds to a specific entry).
        //   2. The entry_id recorded in Redis (the currently live session).
        //   3. DB fallback: the single open entry (orphan recovery when Redis is gone).
        $timerData = Redis::get($redisKey);
        $redisEntryId = null;
        if ($timerData) {
            $decoded = json_decode($timerData, true);
            $redisEntryId = $decoded['entry_id'] ?? null;
        }

        if ($targetEntryId !== null) {
            $entry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('id', $targetEntryId)
                ->where('user_id', $user->id)
                ->where('organization_id', $user->organization_id)
                ->first();

            if (! $entry) {
                throw new \RuntimeException('Target time entry not found.');
            }

            // Idempotent replay: the targeted entry is already closed. Return it as-is,
            // and only clear Redis if it actually points at this same entry — so we
            // never wipe the key for a different, still-running session (BUG 3).
            if ($entry->ended_at !== null) {
                if ($redisEntryId === $entry->id) {
                    Redis::del($redisKey);
                }
                return ['entry' => $entry, 'already_stopped' => true];
            }
        } else {
            // No explicit target — fall back to Redis, then to the DB open entry.
            $entry = null;
            if ($redisEntryId !== null) {
                $entry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('id', $redisEntryId)
                    ->where('user_id', $user->id)
                    ->first();

                if ($entry && $entry->ended_at !== null) {
                    Redis::del($redisKey);
                    return ['entry' => $entry, 'already_stopped' => true];
                }
            }

            if (! $entry) {
                // Redis missing/stale — the DB is source of truth. Close the lone open entry.
                $entry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('user_id', $user->id)
                    ->where('organization_id', $user->organization_id)
                    ->whereNull('ended_at')
                    ->whereNull('deleted_at')
                    ->latest('started_at')
                    ->first();
            }

            if (! $entry) {
                // No open entry anywhere — idempotent stop if a recent closed entry exists.
                $lastEntry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('user_id', $user->id)
                    ->whereNotNull('ended_at')
                    ->latest('ended_at')
                    ->first();

                if ($lastEntry) {
                    return ['entry' => $lastEntry, 'already_stopped' => true];
                }

                throw new \RuntimeException('No timer is currently running.');
            }
        }

        // Atomically acquire lock to prevent race condition (same pattern as start())
        if (!Redis::set($lockKey, 1, 'EX', self::LOCK_TTL, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            $entryId = $entry->id;
            $stopped = DB::transaction(function () use ($user, $entryId, $redisEntryId, $redisKey, $overrideStartedAt, $overrideEndedAt) {
                $entry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('id', $entryId)
                    ->where('user_id', $user->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                // Double-check: entry stopped between resolution and lock acquisition.
                if ($entry->ended_at !== null) {
                    if ($redisEntryId === $entry->id) {
                        Redis::del($redisKey);
                    }
                    return ['entry' => $entry->fresh(), 'already_stopped' => true];
                }

                // Resolve final start: honor a validated offline override, else keep stored.
                $startedAt = $overrideStartedAt ? $overrideStartedAt->copy() : $entry->started_at->copy();
                $stopTime = $overrideEndedAt ? $overrideEndedAt->copy() : now();

                // Chronology is validated explicitly (rejects reversed intervals) rather
                // than abs()-masked into a positive bogus duration (BUG 1).
                $duration = $this->computeDuration($startedAt, $stopTime);

                // Finalize activity_score from actual ActivityLog records (ground truth).
                $finalScore = $this->computeFinalActivityScore($entry->id);

                $entry->update([
                    'started_at' => $startedAt,
                    'ended_at' => $stopTime,
                    'duration_seconds' => $duration,
                    'activity_score' => $finalScore ?? $entry->activity_score ?? 0,
                ]);

                return ['entry' => $entry->fresh(), 'already_stopped' => false];
                // NOTE: Redis::del($redisKey) intentionally OUTSIDE this transaction —
                // Redis is not transactional; deleting inside fires even on rollback.
            });

            // Only clear Redis if it pointed at the entry we just closed — never wipe the
            // key for a different live session (BUG 3, lost-response stop replay).
            if ($redisEntryId === $stopped['entry']->id) {
                Redis::del($redisKey);
            }

            if (! $stopped['already_stopped']) {
                TimerStopped::dispatch($stopped['entry']);
            }

            return $stopped;
        } finally {
            Redis::del($lockKey);
        }
    }

    /**
     * Atomically switch the running timer to a different project.
     *
     * In a single DB transaction: stop the current timer (with final activity
     * score) and immediately start a new one on the target project. This
     * ensures zero gap between projects.
     *
     * @return array{stopped: TimeEntry, started: TimeEntry}
     */
    public function switchProject(array $data): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        $timerData = Redis::get($redisKey);
        if (!$timerData) {
            throw new \RuntimeException('No timer is currently running.');
        }

        $timerInfo = json_decode($timerData, true);

        // Validate target project assignment
        if (! empty($data['project_id'])) {
            $project = Project::where('organization_id', $user->organization_id)
                ->findOrFail($data['project_id']);
            if (! $project->isAssignedTo($user)) {
                throw new AuthorizationException('You are not assigned to this project.');
            }
        }

        // Optional idempotency key for the newly-started entry (lets the desktop
        // safely retry a switch whose response was lost on weak network).
        $idempotencyKey = $data['idempotency_key'] ?? null;
        if ($idempotencyKey) {
            // If the key already maps to an OPEN entry, the switch already happened —
            // return it idempotently instead of creating a clashing second open entry.
            $existing = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('organization_id', $user->organization_id)
                ->where('idempotency_key', $idempotencyKey)
                ->first();
            if ($existing) {
                if ($existing->ended_at === null) {
                    $stoppedPrev = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                        ->where('id', $timerInfo['entry_id'])
                        ->where('user_id', $user->id)
                        ->first();
                    return ['stopped' => $stoppedPrev, 'started' => $existing];
                }
                // Key already consumed by a closed entry — don't collide on the unique index.
                $idempotencyKey = null;
            }
        }

        // Atomically acquire lock
        if (!Redis::set($lockKey, 1, 'EX', self::LOCK_TTL, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            $result = DB::transaction(function () use ($user, $data, $timerInfo, $redisKey, $idempotencyKey) {
                // 1. Stop current entry
                $currentEntry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('id', $timerInfo['entry_id'])
                    ->where('user_id', $user->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                $now = now();
                // Clock skew guard: ended_at must never be before started_at.
                $endedAt = $now->lt($currentEntry->started_at) ? $currentEntry->started_at->copy() : $now;
                $duration = $this->computeDuration($currentEntry->started_at, $endedAt);
                $finalScore = $this->computeFinalActivityScore($currentEntry->id);

                $currentEntry->update([
                    'ended_at' => $endedAt,
                    'duration_seconds' => $duration,
                    'activity_score' => $finalScore ?? $currentEntry->activity_score ?? 0,
                ]);

                // 2. Start new entry on target project (begins exactly where the old one ended,
                //    so there is no overlapping/double-counted interval).
                $newEntry = TimeEntry::create([
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'project_id' => $data['project_id'] ?? null,
                    'task_id' => $data['task_id'] ?? null,
                    'started_at' => $endedAt,
                    'type' => 'tracked',
                    'idempotency_key' => $idempotencyKey,
                ]);

                // 3. Update Redis to point to new entry
                Redis::setex($redisKey, 2592000, $this->encodeRedisTimerState($newEntry, 'running'));

                return ['stopped' => $currentEntry->fresh(), 'started' => $newEntry];
            });

            TimerStopped::dispatch($result['stopped']);
            TimerStarted::dispatch($result['started']);

            return $result;
        } catch (\Illuminate\Database\QueryException $e) {
            // BUG 3: a concurrent start could already hold the one-open-timer slot. Resolve
            // the new-entry conflict gracefully rather than escaping as an HTTP 500.
            $existingOpen = $this->resolveOpenTimerConflict($e, $user, $redisKey);
            if ($existingOpen !== null) {
                $stoppedPrev = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('id', $timerInfo['entry_id'])
                    ->where('user_id', $user->id)
                    ->first();
                return ['stopped' => $stoppedPrev, 'started' => $existingOpen];
            }
            throw $e;
        } finally {
            Redis::del($lockKey);
        }
    }

    public function pause(array $data = []): TimeEntry
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        if (! Redis::set($lockKey, 1, 'EX', self::LOCK_TTL, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            $entry = $this->findOpenRunningEntry($user, $redisKey);
            if (! $entry) {
                throw new \RuntimeException('No timer running');
            }

            $meta = $this->getRedisTimerMeta($redisKey);
            if (($meta['state'] ?? 'running') === 'paused') {
                return $entry;
            }

            $pausedAt = ! empty($data['paused_at'])
                ? $this->parseClientTimestamp($data['paused_at'], 'paused_at')
                : now();
            $reason = $data['pause_reason'] ?? $data['reason'] ?? 'idle';

            Redis::setex(
                $redisKey,
                2592000,
                $this->encodeRedisTimerState($entry, 'paused', $pausedAt, $reason)
            );

            return $entry;
        } finally {
            Redis::del($lockKey);
        }
    }

    /**
     * Resume a paused timer (clears Redis pause metadata; entry stays open).
     */
    public function resume(): TimeEntry
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        if (! Redis::set($lockKey, 1, 'EX', self::LOCK_TTL, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            $entry = $this->findOpenRunningEntry($user, $redisKey);
            if (! $entry) {
                throw new \RuntimeException('No timer running');
            }

            $meta = $this->getRedisTimerMeta($redisKey);
            if (($meta['state'] ?? 'running') === 'running') {
                return $entry;
            }

            Redis::setex($redisKey, 2592000, $this->encodeRedisTimerState($entry, 'running'));

            return $entry;
        } finally {
            Redis::del($lockKey);
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function getRedisTimerMeta(string $redisKey): ?array
    {
        $timerData = Redis::get($redisKey);
        if (! $timerData) {
            return null;
        }
        $data = json_decode($timerData, true);
        if (! is_array($data)) {
            return null;
        }
        $data['state'] = $data['state'] ?? 'running';

        return $data;
    }

    private function encodeRedisTimerState(
        TimeEntry $entry,
        string $state = 'running',
        ?\Carbon\Carbon $pausedAt = null,
        ?string $pauseReason = null
    ): string {
        $payload = [
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
            'project_id' => $entry->project_id,
            'task_id' => $entry->task_id,
            'state' => $state,
        ];
        if ($state === 'paused' && $pausedAt) {
            $payload['paused_at'] = $pausedAt->toISOString();
            $payload['pause_reason'] = $pauseReason ?? 'idle';
        }

        return json_encode($payload);
    }

    /**
     * Elapsed seconds for an open entry, optionally frozen at paused_at.
     */
    private function computeOpenEntryElapsed(TimeEntry $entry, ?\Carbon\Carbon $frozenAt = null): int
    {
        $end = $frozenAt ?? now();
        $elapsed = max(0, (int) $entry->started_at->diffInSeconds($end, false));

        return min($elapsed, self::MAX_ENTRY_DURATION);
    }

    public function userHasOpenTimer(User $user): bool
    {
        return TimeEntry::query()
            ->where('user_id', $user->id)
            ->where('organization_id', $user->organization_id)
            ->whereNull('ended_at')
            ->exists();
    }

    /**
     * Close the user's open timer at its last known activity (last heartbeat, or
     * started_at when none). Used to reclaim a timer orphaned by an uninstall /
     * crash / force-kill so it neither counts dead time nor blocks a fresh login.
     * The dead gap between the last heartbeat and now is intentionally excluded.
     */
    public function closeStaleOpenTimer(User $user): ?TimeEntry
    {
        $entry = $this->openEntryForUser($user);

        if ($entry === null) {
            return null;
        }

        $lastHeartbeat = ActivityLog::where('time_entry_id', $entry->id)->max('logged_at');
        $endedAt = $lastHeartbeat ? Carbon::parse($lastHeartbeat) : $entry->started_at;

        $duration = (int) abs($endedAt->diffInSeconds($entry->started_at));
        if ($duration > self::MAX_ENTRY_DURATION) {
            $duration = self::MAX_ENTRY_DURATION;
            $endedAt = $entry->started_at->copy()->addSeconds(self::MAX_ENTRY_DURATION);
        }

        $entry->update([
            'ended_at' => $endedAt,
            'duration_seconds' => $duration,
        ]);

        Redis::del("timer:{$entry->user_id}");

        return $entry;
    }

    /**
     * Resolve the user's open timer entry without relying on the org global scope.
     */
    private function openEntryForUser(User $user): ?TimeEntry
    {
        return TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('organization_id', $user->organization_id)
            ->whereNull('ended_at')
            ->whereNull('deleted_at')
            ->latest('started_at')
            ->first();
    }

    /**
     * Resolve the user's currently open timer entry from Redis, falling back to the DB
     * when the cache is missing or stale. Repairs Redis when a DB open entry is found
     * so status()/stop() stay consistent after Redis restarts or evictions.
     */
    private function findOpenRunningEntry($user, string $redisKey): ?TimeEntry
    {
        $timerData = Redis::get($redisKey);

        if ($timerData) {
            $data = json_decode($timerData, true);
            $entry = TimeEntry::whereNull('ended_at')->find($data['entry_id'] ?? null);
            if ($entry) {
                return $entry;
            }
            Redis::del($redisKey);
        }

        $openEntry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('organization_id', $user->organization_id)
            ->whereNull('ended_at')
            ->whereNull('deleted_at')
            ->latest('started_at')
            ->first();

        if ($openEntry) {
            Redis::setex($redisKey, 2592000, $this->encodeRedisTimerState($openEntry, 'running'));
        }

        return $openEntry;
    }

    /**
     * Build status payload for an open entry (running or paused).
     *
     * @return array<string, mixed>
     */
    private function buildOpenEntryStatus(
        TimeEntry $entry,
        int $todayTotal,
        ?string $requestedProjectId,
        string $currentDay,
        string $redisKey,
        $todayStartUtc,
        $todayEndUtc
    ): array {
        $meta = $this->getRedisTimerMeta($redisKey) ?? ['state' => 'running'];
        $isPaused = ($meta['state'] ?? 'running') === 'paused';
        $pausedAt = ! empty($meta['paused_at']) ? Carbon::parse($meta['paused_at']) : null;
        $frozenAt = $isPaused && $pausedAt ? $pausedAt : null;
        $currentElapsed = $this->computeOpenEntryElapsed($entry, $frozenAt);
        $entryProjectId = $entry->project_id !== null ? (string) $entry->project_id : null;

        if ($requestedProjectId !== null && $entryProjectId === $requestedProjectId) {
            $todayTotal += $currentElapsed;
        } elseif ($requestedProjectId === null) {
            $todayTotal += $currentElapsed;
        }

        if ($entryProjectId !== null && $requestedProjectId === $entryProjectId) {
            $projectTodayTotal = $todayTotal;
        } elseif ($entryProjectId !== null) {
            $projectTodayTotal = (int) TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('user_id', $entry->user_id)
                ->where('started_at', '>=', $todayStartUtc)
                ->where('started_at', '<', $todayEndUtc)
                ->whereNotNull('ended_at')
                ->where('type', 'tracked')
                ->where('project_id', $entryProjectId)
                ->sum('duration_seconds');
            $projectTodayTotal += $currentElapsed;
        } else {
            $projectTodayTotal = $todayTotal;
        }

        $entry->loadMissing('project:id,name,color');
        $timerState = $isPaused ? 'paused' : 'running';

        return [
            'state' => $timerState,
            'running' => ! $isPaused,
            'paused' => $isPaused,
            'entry' => $entry,
            'elapsed_seconds' => $currentElapsed,
            'today_total' => $todayTotal,
            'project_today_total' => $projectTodayTotal,
            'current_day' => $currentDay,
            'server_time' => now()->toISOString(),
            'paused_at' => $pausedAt?->toISOString(),
            'pause_reason' => $isPaused ? ($meta['pause_reason'] ?? null) : null,
        ];
    }

    /**
     * Get timer status. When $projectId is provided, today_total is scoped to that project.
     * "Today" is the user's current calendar day in their timezone (stored as UTC in DB).
     *
     * Always returns `project_today_total` — the total for the currently running entry's
     * project — so the web header timer can show per-project time without a second API call.
     */
    public function status(?string $projectId = null): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $tz = $user->getTimezoneForDates();

        // Current day = user's calendar day in their timezone (00:00–23:59 local → UTC bounds for DB)
        [$todayStartUtc, $todayEndUtc] = TimezoneAwareDateRange::userTodayUtcBounds($tz);
        $currentDay = Carbon::now($tz)->toDateString();

        $todayQuery = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $todayStartUtc)
            ->where('started_at', '<', $todayEndUtc)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked');

        if ($projectId !== null) {
            $todayQuery->where('project_id', $projectId);
        }

        $todayTotal = (int) $todayQuery->sum('duration_seconds');

        $entry = $this->findOpenRunningEntry($user, $redisKey);
        if (! $entry) {
            return [
                'state' => 'stopped',
                'running' => false,
                'paused' => false,
                'entry' => null,
                'elapsed_seconds' => 0,
                'today_total' => $todayTotal,
                'project_today_total' => 0,
                'current_day' => $currentDay,
                'server_time' => now()->toISOString(),
            ];
        }

        $requestedProjectId = $projectId !== null && $projectId !== '' ? (string) $projectId : null;

        return $this->buildOpenEntryStatus(
            $entry,
            $todayTotal,
            $requestedProjectId,
            $currentDay,
            $redisKey,
            $todayStartUtc,
            $todayEndUtc
        );
    }

    /**
     * Get today's total tracked seconds for the current user (user's calendar day in their timezone).
     * Optionally filter by project_id. If timer is running for that project, includes current elapsed.
     */
    public function todayTotal(?string $projectId = null): int
    {
        $user = Auth::user();
        [$todayStartUtc, $todayEndUtc] = TimezoneAwareDateRange::userTodayUtcBounds($user->getTimezoneForDates());

        $query = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $todayStartUtc)
            ->where('started_at', '<', $todayEndUtc)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked');

        if ($projectId !== null && $projectId !== '') {
            $query->where('project_id', $projectId);
        }

        $total = (int) $query->sum('duration_seconds');

        // If timer is running and entry is for this project, add current elapsed
        $redisKey = "timer:{$user->id}";
        $entry = $this->findOpenRunningEntry($user, $redisKey);
        if ($entry && ($projectId === null || $projectId === '' || (string) $entry->project_id === (string) $projectId)) {
            $meta = $this->getRedisTimerMeta($redisKey);
            $isPaused = ($meta['state'] ?? 'running') === 'paused';
            $frozenAt = $isPaused && ! empty($meta['paused_at'])
                ? Carbon::parse($meta['paused_at'])
                : null;
            $elapsed = $this->computeOpenEntryElapsed($entry, $frozenAt);
            $total += $elapsed;
        }

        return $total;
    }

    /**
     * Report idle time from the desktop agent.
     *
     * Actions:
     * - keep: no change, timer continues.
     * - discard: shorten running entry to idle_started_at, create idle entry (audit),
     *   create new tracked entry from idle_ended_at and set Redis so timer continues.
     * - reassign: same as discard but create a tracked entry on project_id for the
     *   idle period so that time counts toward the chosen project.
     */
    public function reportIdle(array $data): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        // Atomically acquire lock to prevent race condition (same pattern as start())
        if (!Redis::set($lockKey, 1, 'EX', self::LOCK_TTL, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            $timerData = Redis::get($redisKey);
            if (!$timerData) {
                return ['idle_entry' => null, 'new_entry' => null];
            }

            $timerInfo = json_decode($timerData, true);
            $entryId = $timerInfo['entry_id'] ?? null;
            if (!$entryId) {
                return ['idle_entry' => null, 'new_entry' => null];
            }

            // FIX B6: Validate that the client's time_entry_id matches the Redis entry
            $requestedEntryId = $data['time_entry_id'] ?? null;
            if ($requestedEntryId && $requestedEntryId !== $entryId) {
                throw new \RuntimeException('time_entry_id does not match current running timer.', 409);
            }

            $currentEntry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('id', $entryId)
                ->where('user_id', $user->id)
                ->first();
            if (!$currentEntry) {
                return ['idle_entry' => null, 'new_entry' => null];
            }

            $idleStartedAt = \Carbon\Carbon::parse($data['idle_started_at']);
            $idleEndedAt = \Carbon\Carbon::parse($data['idle_ended_at']);
            $idleSeconds = (int) ($data['idle_seconds'] ?? 0);
            $action = $data['action'] ?? 'discard';
            $reassignProjectId = $data['project_id'] ?? null;

            // FIX B2: Check project assignment for reassign action
            if ($action === 'reassign' && $reassignProjectId) {
                $project = \App\Models\Project::where('organization_id', $user->organization_id)
                    ->find($reassignProjectId);
                if (!$project || !$project->isAssignedTo($user)) {
                    throw new AuthorizationException('You are not assigned to this project.');
                }
            }

            // FIX B4: Idempotency — detect already-applied split
            // If the current entry's started_at >= idle_ended_at, the split already happened
            if ($currentEntry->started_at && $idleEndedAt->lte($currentEntry->started_at)) {
                return ['idle_entry' => null, 'new_entry' => $currentEntry];
            }

            // Clamp idle_started_at to entry's started_at to prevent negative durations
            if ($idleStartedAt->lt($currentEntry->started_at)) {
                $idleStartedAt = $currentEntry->started_at->copy();
            }

            // FIX B5: Compute duration_seconds server-side from timestamps.
            // Chronology is validated (idle_started_at <= idle_ended_at) rather than
            // abs()-masked; the controller already guarantees idle_ended_at > idle_started_at,
            // and idle_started_at was clamped to the entry start above.
            $computedIdleSeconds = $this->computeDuration($idleStartedAt, $idleEndedAt);

            $result = DB::transaction(function () use (
            $user,
            $currentEntry,
            $idleStartedAt,
            $idleEndedAt,
            $computedIdleSeconds,
            $action,
            $reassignProjectId
        ) {
            // 1. Close current entry at idle start (shorten it). idle_started_at was
            //    clamped to be >= the entry start, so this interval is never reversed.
            $currentEntry->update([
                'ended_at' => $idleStartedAt,
                'duration_seconds' => $this->computeDuration($currentEntry->started_at, $idleStartedAt),
            ]);

            // 2. Idle entry for audit (always created on discard/reassign)
            $idleEntry = TimeEntry::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'project_id' => $currentEntry->project_id,
                'task_id' => $currentEntry->task_id,
                'started_at' => $idleStartedAt,
                'ended_at' => $idleEndedAt,
                'duration_seconds' => $computedIdleSeconds,
                'type' => 'idle',
                'notes' => $action === 'reassign' ? 'Idle time reassigned to another project' : 'Idle time discarded by user',
            ]);

            // FIX B10: Re-associate idle-period screenshots to the idle entry
            \App\Models\Screenshot::where('time_entry_id', $currentEntry->id)
                ->where('captured_at', '>', $idleStartedAt)
                ->update(['time_entry_id' => $idleEntry->id]);

            $newEntry = null;

            if ($action === 'reassign' && $reassignProjectId) {
                // 3a. Create tracked entry on target project for the idle period
                TimeEntry::create([
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'project_id' => $reassignProjectId,
                    'task_id' => null,
                    'started_at' => $idleStartedAt,
                    'ended_at' => $idleEndedAt,
                    'duration_seconds' => $computedIdleSeconds,
                    'type' => 'tracked',
                    'notes' => 'Idle time reassigned from timer',
                ]);
            }

            // 4. New running entry from idle_ended_at (same project as original)
            // FIX B3: Redis::setex() is intentionally moved OUTSIDE this transaction
            $newEntry = TimeEntry::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'project_id' => $currentEntry->project_id,
                'task_id' => $currentEntry->task_id,
                'started_at' => $idleEndedAt,
                'type' => 'tracked',
            ]);

            return ['idle_entry' => $idleEntry, 'new_entry' => $newEntry];
        });

            // FIX B3: Update Redis AFTER DB transaction commits to prevent orphaned state
            $newEntry = $result['new_entry'];
            try {
                Redis::setex($redisKey, 2592000, $this->encodeRedisTimerState($newEntry, 'running'));
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::error('Redis update failed after idle split', ['error' => $e->getMessage()]);
            }

            return $result;
        } finally {
            Redis::del($lockKey);
        }
    }

    public function processHeartbeat(array $data): ActivityLog
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";

        $timerData = Redis::get($redisKey);
        if (!$timerData) {
            throw new \RuntimeException('No timer is currently running.');
        }

        $timerInfo = json_decode($timerData, true);

        $logData = [
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'time_entry_id' => $timerInfo['entry_id'],
            'logged_at' => now(),
            'keyboard_events' => $data['keyboard_events'] ?? 0,
            'mouse_events' => $data['mouse_events'] ?? 0,
            'active_app' => $data['active_app'] ?? null,
            'active_window_title' => $data['active_window_title'] ?? null,
            'active_url' => $data['active_url'] ?? null,
        ];

        // Store active_seconds if provided by new desktop versions
        if (isset($data['active_seconds'])) {
            $logData['active_seconds'] = (int) $data['active_seconds'];
        }

        $log = ActivityLog::create($logData);

        // Update activity score on entry using exponential moving average (EMA).
        // If the desktop sends active_seconds (Hubstaff-standard active-seconds model),
        // compute score as percentage of seconds with input. Otherwise fall back to
        // event-count method for backward compatibility with older desktop versions.
        $entry = TimeEntry::find($timerInfo['entry_id']);
        if ($entry) {
            if (isset($data['active_seconds'])) {
                // Active-seconds model: score = active_seconds / interval_seconds * 100
                // Heartbeat interval is 30s, but use actual active_seconds capped at 30
                $intervalSeconds = 30;
                $activeSeconds = min((int) $data['active_seconds'], $intervalSeconds);
                $instantScore = (int) round(($activeSeconds / $intervalSeconds) * 100);
            } else {
                // Legacy event-count model (backward compat with old desktop versions)
                $maxExpected = 300;
                $total = ($data['keyboard_events'] ?? 0) + ($data['mouse_events'] ?? 0);
                $instantScore = min(100, (int) round($total / $maxExpected * 100));
            }

            $alpha = 0.3; // smoothing factor
            if ($entry->activity_score !== null && $entry->activity_score > 0) {
                $score = (int) round($alpha * $instantScore + (1 - $alpha) * $entry->activity_score);
            } else {
                $score = $instantScore;
            }
            $entry->update(['activity_score' => max(0, min(100, $score))]);
        }

        $user->update(['last_active_at' => now()]);

        // Record app usage duration for the app usage tracking feature
        if (!empty($data['active_app'])) {
            $intervalSeconds = isset($data['active_seconds']) ? (int) $data['active_seconds'] : 30;
            app(AppUsageService::class)->recordHeartbeat(
                $user,
                $data['active_app'],
                $data['active_window_title'] ?? null,
                $intervalSeconds
            );
        }

        return $log;
    }

    /**
     * Compute final activity score from ActivityLog records (ground truth).
     *
     * Uses active-seconds model when available (Hubstaff standard):
     *   total_active_seconds / total_interval_seconds * 100
     *
     * Falls back to event-count averaging for entries tracked by older
     * desktop versions that don't send active_seconds.
     *
     * Returns null if no activity logs exist (entry had no heartbeats).
     */
    private function computeFinalActivityScore(string $entryId): ?int
    {
        $logs = ActivityLog::where('time_entry_id', $entryId)
            ->select('keyboard_events', 'mouse_events', 'active_seconds')
            ->get();

        if ($logs->isEmpty()) {
            return null;
        }

        // Check if any logs have active_seconds (new desktop version)
        $hasActiveSeconds = $logs->contains(fn ($log) => $log->active_seconds !== null);

        if ($hasActiveSeconds) {
            // Active-seconds model: sum all active seconds / total interval seconds
            $totalActiveSeconds = 0;
            $totalIntervalSeconds = 0;
            $intervalLength = 30; // each heartbeat = 30s interval

            foreach ($logs as $log) {
                if ($log->active_seconds !== null) {
                    $totalActiveSeconds += min($log->active_seconds, $intervalLength);
                    $totalIntervalSeconds += $intervalLength;
                } else {
                    // Mixed mode: some heartbeats from old version, skip them
                    // or estimate from events (use event-count as proxy)
                    $totalIntervalSeconds += $intervalLength;
                }
            }

            if ($totalIntervalSeconds === 0) {
                return 0;
            }

            return max(0, min(100, (int) round(($totalActiveSeconds / $totalIntervalSeconds) * 100)));
        }

        // Legacy event-count model (backward compat)
        $maxExpected = 300;
        $totalScore = 0;
        foreach ($logs as $log) {
            $events = $log->keyboard_events + $log->mouse_events;
            $totalScore += min(100, (int) round($events / $maxExpected * 100));
        }

        return (int) round($totalScore / $logs->count());
    }
}
