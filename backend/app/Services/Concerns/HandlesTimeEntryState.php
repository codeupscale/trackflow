<?php

namespace App\Services\Concerns;

use App\Models\ActivityLog;
use App\Models\TimeEntry;
use Carbon\Carbon;
use Illuminate\Support\Facades\Redis;

/**
 * Time-entry primitives shared by TimerService (read paths: status, today-total,
 * heartbeat, stale-close) and TimeEntrySyncService (the desktop upsert path).
 *
 * These were private methods on TimerService. They are extracted rather than
 * duplicated because the two services must agree EXACTLY on how a duration is
 * computed, how a client clock is validated, and how the Redis timer key is
 * encoded — a divergence between them would show up as the web dashboard and the
 * desktop disagreeing about whether a timer is running.
 */
trait HandlesTimeEntryState
{
    /**
     * Hard ceiling on a single entry's duration. Config-driven so it can be tuned
     * without a deploy; see config/timer.php for why it is not reachable in normal
     * operation (the agent splits at midnight).
     */
    protected function maxEntryDuration(): int
    {
        return (int) config('timer.max_entry_duration', 86400);
    }

    /**
     * Parse and validate a client-supplied timestamp against the allowed skew window.
     *
     * - Rejects timestamps more than `timer.max_future_skew` ahead (bad forward clock).
     * - Clamps near-future-but-within-skew values back to now(), so stored data never
     *   claims a future start.
     * - Rejects timestamps older than `timer.max_past_skew` (corrupt backward clock).
     *
     * @throws \InvalidArgumentException on an out-of-window timestamp.
     */
    protected function parseClientTimestamp(string $raw, string $field): Carbon
    {
        try {
            $ts = Carbon::parse($raw);
        } catch (\Throwable $e) {
            throw new \InvalidArgumentException("{$field} is not a valid timestamp.");
        }

        $now = now();
        $futureSkew = (int) config('timer.max_future_skew', 300);
        $pastSkew = (int) config('timer.max_past_skew', 2592000);

        if ($ts->gt($now->copy()->addSeconds($futureSkew))) {
            throw new \InvalidArgumentException("{$field} cannot be in the future.");
        }

        if ($ts->gt($now)) {
            $ts = $now->copy();
        }

        if ($ts->lt($now->copy()->subSeconds($pastSkew))) {
            throw new \InvalidArgumentException("{$field} is too far in the past.");
        }

        return $ts;
    }

    /**
     * Duration in seconds with EXPLICIT chronology validation. A reversed interval is
     * rejected rather than abs()-masked into a plausible-looking positive number, which
     * is how corrupt clocks used to silently produce bogus billable time.
     *
     * @throws \InvalidArgumentException when $endedAt precedes $startedAt.
     */
    protected function computeDuration(Carbon $startedAt, Carbon $endedAt): int
    {
        $seconds = $startedAt->diffInSeconds($endedAt, false);

        if ($seconds < 0) {
            throw new \InvalidArgumentException('ended_at must be on or after started_at.');
        }

        return min((int) $seconds, $this->maxEntryDuration());
    }

    /**
     * Decode the per-user Redis timer key, defaulting the state field for keys written
     * before 'state' existed.
     *
     * @return array<string, mixed>|null
     */
    protected function getRedisTimerMeta(string $redisKey): ?array
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

    /**
     * Encode the per-user Redis timer key. This key is what `GET /timer/status` reads,
     * and therefore what the WEB dashboard renders as "currently tracking" — the sync
     * path must maintain it even though the desktop itself never reads it.
     */
    protected function encodeRedisTimerState(
        TimeEntry $entry,
        string $state = 'running',
        ?Carbon $pausedAt = null,
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
     * Finalize activity_score from the entry's ActivityLog rows (ground truth), rather
     * than trusting the running score the agent reported.
     *
     * Uses the active-seconds model when available (Hubstaff standard):
     *   total_active_seconds / total_interval_seconds * 100
     * Falls back to event-count averaging for entries tracked by older desktop builds
     * that never sent active_seconds.
     *
     * Returns null when the entry has no heartbeats at all, so callers can distinguish
     * "no data" from a genuine zero and preserve any existing score.
     */
    protected function computeFinalActivityScore(string $entryId): ?int
    {
        $logs = ActivityLog::where('time_entry_id', $entryId)
            ->select('keyboard_events', 'mouse_events', 'active_seconds')
            ->get();

        if ($logs->isEmpty()) {
            return null;
        }

        $hasActiveSeconds = $logs->contains(fn ($log) => $log->active_seconds !== null);

        if ($hasActiveSeconds) {
            $totalActiveSeconds = 0;
            $totalIntervalSeconds = 0;
            $intervalLength = 30; // each heartbeat covers a 30s interval

            foreach ($logs as $log) {
                if ($log->active_seconds !== null) {
                    $totalActiveSeconds += min($log->active_seconds, $intervalLength);
                }
                // Mixed mode: heartbeats from an old build still consume interval time,
                // so they correctly drag the score down rather than being ignored.
                $totalIntervalSeconds += $intervalLength;
            }

            if ($totalIntervalSeconds === 0) {
                return 0;
            }

            return max(0, min(100, (int) round(($totalActiveSeconds / $totalIntervalSeconds) * 100)));
        }

        // Legacy event-count model (backward compat).
        $maxExpected = 300;
        $totalScore = 0;
        foreach ($logs as $log) {
            $events = $log->keyboard_events + $log->mouse_events;
            $totalScore += min(100, (int) round($events / $maxExpected * 100));
        }

        return (int) round($totalScore / $logs->count());
    }
}
