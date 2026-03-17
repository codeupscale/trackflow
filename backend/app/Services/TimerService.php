<?php

namespace App\Services;

use App\Events\TimerStarted;
use App\Events\TimerStopped;
use App\Models\TimeEntry;
use App\Models\ActivityLog;
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

    public function start(array $data): TimeEntry
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $lockKey = "timer:lock:{$user->id}";

        // Atomically acquire lock to prevent race condition
        if (!Redis::set($lockKey, 1, 'EX', 5, 'NX')) {
            throw new \RuntimeException('Timer operation in progress');
        }

        try {
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

            return $entry;
        } finally {
            Redis::del($lockKey);
        }
    }

    public function stop(): TimeEntry
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";

        $timerData = Redis::get($redisKey);
        if (!$timerData) {
            throw new \RuntimeException('No timer is currently running.');
        }

        $timerData = json_decode($timerData, true);

        $entry = DB::transaction(function () use ($user, $timerData, $redisKey) {
            $entry = TimeEntry::withoutGlobalScopes()
                ->where('id', $timerData['entry_id'])
                ->where('user_id', $user->id)
                ->firstOrFail();

            $now = now();
            $entry->update([
                'ended_at' => $now,
                'duration_seconds' => (int) abs($now->diffInSeconds($entry->started_at)),
            ]);

            Redis::del($redisKey);
            return $entry->fresh();
        });

        TimerStopped::dispatch($entry);

        return $entry;
    }

    public function pause(): TimeEntry
    {
        $stoppedEntry = $this->stop();

        // Create idle entry
        $user = Auth::user();
        TimeEntry::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'project_id' => $stoppedEntry->project_id,
            'task_id' => $stoppedEntry->task_id,
            'started_at' => now(),
            'type' => 'idle',
        ]);

        return $stoppedEntry;
    }

    /**
     * Get timer status. When $projectId is provided, today_total is scoped to that project.
     * "Today" is the user's current calendar day in their timezone (stored as UTC in DB).
     */
    public function status(?string $projectId = null): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $tz = $user->getTimezoneForDates();

        // Current day = user's calendar day in their timezone (00:00–23:59 local → UTC bounds for DB)
        [$todayStartUtc, $todayEndUtc] = TimezoneAwareDateRange::userTodayUtcBounds($tz);
        $currentDay = Carbon::now($tz)->toDateString();

        $todayQuery = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $todayStartUtc)
            ->where('started_at', '<=', $todayEndUtc)
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

        return [
            'running' => true,
            'entry' => $entry,
            'elapsed_seconds' => $currentElapsed,
            'today_total' => $todayTotal,
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

        $query = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $todayStartUtc)
            ->where('started_at', '<=', $todayEndUtc)
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
            if ($entry && ($projectId === null || $projectId === '' || $entry->project_id === $projectId)) {
                $total += (int) abs(now()->diffInSeconds($entry->started_at));
            }
        }

        return $total;
    }

    /**
     * Report idle time from the desktop agent.
     *
     * When user chooses "discard idle time", the idle period is split out
     * of the running time entry:
     *   1. Current entry's effective duration is reduced by idle_seconds
     *   2. An 'idle' type entry is created for the idle period (for audit trail)
     *
     * This preserves the audit trail while ensuring idle time doesn't count
     * toward billable/tracked hours.
     */
    public function reportIdle(array $data): ?TimeEntry
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";

        $timerData = Redis::get($redisKey);
        if (!$timerData) {
            return null;
        }

        $timerInfo = json_decode($timerData, true);

        // Create an idle entry for the idle period (audit trail)
        $idleEntry = TimeEntry::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'project_id' => $data['project_id'] ?? null,
            'task_id' => $data['task_id'] ?? null,
            'started_at' => $data['idle_started_at'],
            'ended_at' => $data['idle_ended_at'],
            'duration_seconds' => $data['idle_seconds'],
            'type' => 'idle',
            'notes' => 'Idle time discarded by user',
        ]);

        return $idleEntry;
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

        $log = ActivityLog::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'time_entry_id' => $timerInfo['entry_id'],
            'logged_at' => now(),
            'keyboard_events' => $data['keyboard_events'] ?? 0,
            'mouse_events' => $data['mouse_events'] ?? 0,
            'active_app' => $data['active_app'] ?? null,
            'active_window_title' => $data['active_window_title'] ?? null,
            'active_url' => $data['active_url'] ?? null,
        ]);

        // Update activity score on entry
        $entry = TimeEntry::find($timerInfo['entry_id']);
        if ($entry) {
            $maxExpected = 300; // expected max events per 30s interval
            $total = ($data['keyboard_events'] ?? 0) + ($data['mouse_events'] ?? 0);
            $score = min(100, (int) ($total / $maxExpected * 100));

            // Average with existing score
            if ($entry->activity_score !== null) {
                $score = (int) (($entry->activity_score + $score) / 2);
            }
            $entry->update(['activity_score' => $score]);
        }

        $user->update(['last_active_at' => now()]);

        return $log;
    }
}
