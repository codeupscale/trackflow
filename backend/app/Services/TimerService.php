<?php

namespace App\Services;

use App\Events\TimerStarted;
use App\Events\TimerStopped;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\ActivityLog;
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
     * Start a timer. Returns ['entry' => TimeEntry, 'is_existing' => bool].
     * When an idempotency_key matches an open entry, returns the existing one (is_existing=true).
     */
    public function start(array $data): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        // Idempotency check — BEFORE lock acquisition (read-only, safe without lock).
        // If the desktop/client sends the same idempotency_key for a start that already
        // succeeded, return the existing open entry instead of creating a duplicate.
        if (! empty($data['idempotency_key'])) {
            $idempotent = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('organization_id', $user->organization_id)
                ->where('idempotency_key', $data['idempotency_key'])
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
        if (!Redis::set($lockKey, 1, 'EX', 5, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            // Duplicate timer guard: if a timer is already running, auto-stop it first.
            // This prevents orphaned entries when desktop is tracking and user starts from web (or vice versa).
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
                        // Clock skew guard: ended_at must never be before started_at
                        $endedAt = $now->lt($existingEntry->started_at) ? $existingEntry->started_at->copy() : $now;
                        $duration = min(
                            (int) abs($existingEntry->started_at->diffInSeconds($endedAt)),
                            self::MAX_ENTRY_DURATION
                        );
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
            }

            // Use DB transaction and set Redis BEFORE committing
            $entry = DB::transaction(function () use ($user, $data, $redisKey) {
                $entry = TimeEntry::create([
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'project_id' => $data['project_id'] ?? null,
                    'task_id' => $data['task_id'] ?? null,
                    'notes' => $data['notes'] ?? null,
                    'started_at' => now(),
                    'type' => 'tracked',
                    'idempotency_key' => $data['idempotency_key'] ?? null,
                ]);

                // Set Redis before committing to maintain consistency
                Redis::setex($redisKey, 2592000, json_encode([
                    'entry_id' => $entry->id,
                    'started_at' => $entry->started_at->toISOString(),
                    'project_id' => $entry->project_id,
                    'task_id' => $entry->task_id,
                ]));

                return $entry;
            });

            TimerStarted::dispatch($entry);

            return ['entry' => $entry, 'is_existing' => false];
        } finally {
            Redis::del($lockKey);
        }
    }

    /**
     * Stop the running timer. Returns ['entry' => TimeEntry, 'already_stopped' => bool].
     *
     * @param array $data Optional: 'started_at' and 'ended_at' for offline sync.
     *                    Both must be in the past. ended_at must be after started_at.
     */
    public function stop(array $data = []): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        // Parse and validate optional offline timestamps (never trust future times)
        $overrideEndedAt = null;
        $overrideStartedAt = null;

        if (! empty($data['ended_at'])) {
            $overrideEndedAt = Carbon::parse($data['ended_at']);
            if ($overrideEndedAt->isFuture()) {
                throw new \InvalidArgumentException('ended_at cannot be in the future.');
            }
        }
        if (! empty($data['started_at'])) {
            $overrideStartedAt = Carbon::parse($data['started_at']);
            if ($overrideStartedAt->isFuture()) {
                throw new \InvalidArgumentException('started_at cannot be in the future.');
            }
        }
        if ($overrideStartedAt && $overrideEndedAt && $overrideEndedAt->lte($overrideStartedAt)) {
            throw new \InvalidArgumentException('ended_at must be after started_at.');
        }

        $timerData = Redis::get($redisKey);
        if (!$timerData) {
            // No Redis key — check if the most recent entry for this user is already stopped.
            // This handles the case where desktop queued a stop that already completed.
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

        $timerData = json_decode($timerData, true);

        // Check if the entry is already stopped (race condition / duplicate stop)
        $checkEntry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('id', $timerData['entry_id'])
            ->where('user_id', $user->id)
            ->first();

        if ($checkEntry && $checkEntry->ended_at !== null) {
            // Already stopped — clean up stale Redis key and return gracefully
            Redis::del($redisKey);
            return ['entry' => $checkEntry, 'already_stopped' => true];
        }

        // Atomically acquire lock to prevent race condition (same pattern as start())
        if (!Redis::set($lockKey, 1, 'EX', 5, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            $entry = DB::transaction(function () use ($user, $timerData, $redisKey, $overrideStartedAt, $overrideEndedAt) {
                $entry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('id', $timerData['entry_id'])
                    ->where('user_id', $user->id)
                    ->firstOrFail();

                // Double-check: if entry was stopped between our check and lock acquisition
                if ($entry->ended_at !== null) {
                    Redis::del($redisKey);
                    return $entry;
                }

                // Apply offline overrides if provided
                if ($overrideStartedAt) {
                    $entry->started_at = $overrideStartedAt;
                }

                $stopTime = $overrideEndedAt ?? now();
                $duration = min(
                    (int) abs($stopTime->diffInSeconds($entry->started_at)),
                    self::MAX_ENTRY_DURATION
                );

                // Finalize activity_score from actual ActivityLog records (ground truth).
                // This replaces the running EMA with a proper weighted calculation.
                $finalScore = $this->computeFinalActivityScore($entry->id);

                $entry->update([
                    'started_at' => $entry->started_at, // Persist override if applied
                    'ended_at' => $stopTime,
                    'duration_seconds' => $duration,
                    'activity_score' => $finalScore ?? $entry->activity_score ?? 0,
                ]);

                Redis::del($redisKey);
                return $entry->fresh();
            });

            TimerStopped::dispatch($entry);

            return ['entry' => $entry, 'already_stopped' => false];
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

        // Atomically acquire lock
        if (!Redis::set($lockKey, 1, 'EX', 5, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
            $result = DB::transaction(function () use ($user, $data, $timerInfo, $redisKey) {
                // 1. Stop current entry
                $currentEntry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                    ->where('id', $timerInfo['entry_id'])
                    ->where('user_id', $user->id)
                    ->firstOrFail();

                $now = now();
                // Clock skew guard: ended_at must never be before started_at
                $endedAt = $now->lt($currentEntry->started_at) ? $currentEntry->started_at->copy() : $now;
                $duration = min(
                    (int) abs($currentEntry->started_at->diffInSeconds($endedAt)),
                    self::MAX_ENTRY_DURATION
                );
                $finalScore = $this->computeFinalActivityScore($currentEntry->id);

                $currentEntry->update([
                    'ended_at' => $endedAt,
                    'duration_seconds' => $duration,
                    'activity_score' => $finalScore ?? $currentEntry->activity_score ?? 0,
                ]);

                // 2. Start new entry on target project
                $newEntry = TimeEntry::create([
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'project_id' => $data['project_id'] ?? null,
                    'task_id' => $data['task_id'] ?? null,
                    'started_at' => $now,
                    'type' => 'tracked',
                ]);

                // 3. Update Redis to point to new entry
                Redis::setex($redisKey, 2592000, json_encode([
                    'entry_id' => $newEntry->id,
                    'started_at' => $newEntry->started_at->toISOString(),
                    'project_id' => $newEntry->project_id,
                    'task_id' => $newEntry->task_id,
                ]));

                return ['stopped' => $currentEntry->fresh(), 'started' => $newEntry];
            });

            TimerStopped::dispatch($result['stopped']);
            TimerStarted::dispatch($result['started']);

            return $result;
        } finally {
            Redis::del($lockKey);
        }
    }

    public function pause(): TimeEntry
    {
        $result = $this->stop();
        $stoppedEntry = $result['entry'];

        // Create idle entry (point-in-time record, zero duration)
        $user = Auth::user();
        $idleNow = now();
        TimeEntry::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'project_id' => $stoppedEntry->project_id,
            'task_id' => $stoppedEntry->task_id,
            'started_at' => $idleNow,
            'ended_at' => $idleNow,
            'duration_seconds' => 0,
            'type' => 'idle',
        ]);

        return $stoppedEntry;
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

        $timerData = Redis::get($redisKey);
        if (!$timerData) {
            return [
                'running' => false,
                'entry' => null,
                'elapsed_seconds' => 0,
                'today_total' => $todayTotal,
                'project_today_total' => 0,
                'current_day' => $currentDay,
            ];
        }

        $data = json_decode($timerData, true);
        $entry = TimeEntry::find($data['entry_id'] ?? null);
        if (!$entry) {
            return [
                'running' => false,
                'entry' => null,
                'elapsed_seconds' => 0,
                'today_total' => $todayTotal,
                'project_today_total' => 0,
                'current_day' => $currentDay,
            ];
        }

        $now = Carbon::now();
        $currentElapsed = (int) abs($now->diffInSeconds($entry->started_at));
        $entryProjectId = $entry->project_id !== null ? (string) $entry->project_id : null;
        $requestedProjectId = $projectId !== null && $projectId !== '' ? (string) $projectId : null;

        // Include current running time only if it's for the requested project
        if ($requestedProjectId !== null && $entryProjectId === $requestedProjectId) {
            $todayTotal += $currentElapsed;
        } elseif ($requestedProjectId === null) {
            $todayTotal += $currentElapsed;
        }

        // Per-project total for the running entry's project (for web header timer).
        // If $projectId was already set to this project, reuse $todayTotal to avoid a second query.
        if ($entryProjectId !== null && $requestedProjectId === $entryProjectId) {
            $projectTodayTotal = $todayTotal;
        } elseif ($entryProjectId !== null) {
            $projectTodayTotal = (int) TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('user_id', $user->id)
                ->where('started_at', '>=', $todayStartUtc)
                ->where('started_at', '<', $todayEndUtc)
                ->whereNotNull('ended_at')
                ->where('type', 'tracked')
                ->where('project_id', $entryProjectId)
                ->sum('duration_seconds');
            $projectTodayTotal += $currentElapsed;
        } else {
            // No project on the running entry — fall back to global total
            $projectTodayTotal = $todayTotal;
        }

        // Eager-load project so the web dashboard can display the project name
        $entry->loadMissing('project:id,name,color');

        return [
            'running' => true,
            'entry' => $entry,
            'elapsed_seconds' => $currentElapsed,
            'today_total' => $todayTotal,
            'project_today_total' => $projectTodayTotal,
            'current_day' => $currentDay,
        ];
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
        $timerData = Redis::get($redisKey);
        if ($timerData) {
            $data = json_decode($timerData, true);
            $entry = TimeEntry::find($data['entry_id'] ?? null);
            if ($entry && ($projectId === null || $projectId === '' || (string) $entry->project_id === (string) $projectId)) {
                $total += (int) abs(now()->diffInSeconds($entry->started_at));
            }
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
        if (!Redis::set($lockKey, 1, 'EX', 5, 'NX')) {
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

            // Clamp idle_started_at to entry's started_at to prevent negative durations
            if ($idleStartedAt->lt($currentEntry->started_at)) {
                $idleStartedAt = $currentEntry->started_at->copy();
            }

            $result = DB::transaction(function () use (
            $user,
            $currentEntry,
            $redisKey,
            $timerInfo,
            $idleStartedAt,
            $idleEndedAt,
            $idleSeconds,
            $action,
            $reassignProjectId
        ) {
            // 1. Close current entry at idle start (shorten it)
            $currentEntry->update([
                'ended_at' => $idleStartedAt,
                'duration_seconds' => (int) abs($idleStartedAt->diffInSeconds($currentEntry->started_at)),
            ]);

            // 2. Idle entry for audit (always created on discard/reassign)
            $idleEntry = TimeEntry::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'project_id' => $currentEntry->project_id,
                'task_id' => $currentEntry->task_id,
                'started_at' => $idleStartedAt,
                'ended_at' => $idleEndedAt,
                'duration_seconds' => $idleSeconds,
                'type' => 'idle',
                'notes' => $action === 'reassign' ? 'Idle time reassigned to another project' : 'Idle time discarded by user',
            ]);

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
                    'duration_seconds' => $idleSeconds,
                    'type' => 'tracked',
                    'notes' => 'Idle time reassigned from timer',
                ]);
            }

            // 4. New running entry from idle_ended_at (same project as original) and set Redis
            $newEntry = TimeEntry::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'project_id' => $currentEntry->project_id,
                'task_id' => $currentEntry->task_id,
                'started_at' => $idleEndedAt,
                'type' => 'tracked',
            ]);

            Redis::setex($redisKey, 2592000, json_encode([
                'entry_id' => $newEntry->id,
                'started_at' => $newEntry->started_at->toISOString(),
                'project_id' => $newEntry->project_id,
                'task_id' => $newEntry->task_id,
            ]));

            return ['idle_entry' => $idleEntry, 'new_entry' => $newEntry];
        });

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
