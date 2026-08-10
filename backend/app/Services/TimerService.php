<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Scopes\GlobalOrganizationScope;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Concerns\HandlesTimeEntryState;
use App\Support\TimezoneAwareDateRange;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redis;

/**
 * READ paths for the timer, plus heartbeat ingestion and stale-timer reclamation.
 *
 * Redis key pattern: timer:{user_id}
 * Value: JSON {entry_id, started_at, project_id, task_id, state}
 * TTL: 30 days (2592000 seconds)
 *
 * WRITES to `type = 'tracked'` entries live in TimeEntrySyncService. The desktop agent
 * owns those rows: it records them in local SQLite and pushes them here as an idempotent
 * upsert. The start / stop / switch / pause / resume / idle methods that used to live in
 * this class were removed in the offline-first refactor — they made the server a SECOND
 * writer to entries the agent also mutated, and every reconcile bug in `bugs/` traces
 * back to that split ownership.
 *
 * This class no longer takes the per-user timer mutex, because it no longer mutates the
 * open-timer slot. `closeStaleOpenTimer()` is the one exception: it is reclamation, not
 * tracking, and is called from the login path.
 */
class TimerService
{
    use HandlesTimeEntryState;

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
     *
     * CALLER BEWARE: under offline-first tracking an open entry is NOT evidence of a
     * dead session — the agent may be tracking offline right now and simply has not
     * pushed yet. Callers must gate on `client_synced_at` staleness before invoking
     * this; see AuthTokenService::terminatePreviousDesktopSessions().
     */
    public function closeStaleOpenTimer(User $user): ?TimeEntry
    {
        $entry = $this->openEntryForUser($user);

        if ($entry === null) {
            return null;
        }

        $lastHeartbeat = ActivityLog::where('time_entry_id', $entry->id)->max('logged_at');
        $endedAt = $lastHeartbeat ? Carbon::parse($lastHeartbeat) : $entry->started_at;

        $maxDuration = $this->maxEntryDuration();
        $duration = (int) abs($endedAt->diffInSeconds($entry->started_at));
        if ($duration > $maxDuration) {
            $duration = $maxDuration;
            $endedAt = $entry->started_at->copy()->addSeconds($maxDuration);
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
     * Elapsed seconds for an open entry, optionally frozen at paused_at.
     *
     * NEVER extrapolates past the agent's last proof of life. `now() - started_at` is
     * only true while the agent is still reporting; the desktop uploads on a 10-minute
     * batch and owns tracked time locally, so between pushes the server's open entry can
     * be a stale replica of state the agent has already changed. Counting it to now()
     * does not merely lag — it INVENTS time and grows it every second:
     *
     *   - after an idle discard, the whole idle gap the agent already dropped
     *   - after Stop, up to a full cadence of "still tracking" (observed on dev:
     *     an entry closed locally at 12:37:16 was still being counted at 13:02:36,
     *     reading 28:58 while the desktop showed the true 11:17)
     *   - after a force-quit or a dead machine, until the 60-minute abandoned backstop
     *
     * So the elapsed clock stops at `liveAsOf()` once the agent has gone quiet for
     * longer than `timer.live_elapsed_grace_minutes`. The figure then freezes at the
     * last instant we have evidence for, which is the honest answer, and callers get
     * `live_as_of` / `elapsed_is_stale` in the status payload so the UI can say so.
     */
    private function computeOpenEntryElapsed(TimeEntry $entry, ?Carbon $frozenAt = null): int
    {
        $end = $frozenAt ?? $this->liveElapsedEnd($entry);
        $elapsed = max(0, (int) $entry->started_at->diffInSeconds($end, false));

        return min($elapsed, $this->maxEntryDuration());
    }

    /**
     * The instant an open entry's elapsed may be measured to: now() while the agent is
     * demonstrably alive, otherwise its last proof of life.
     */
    private function liveElapsedEnd(TimeEntry $entry): Carbon
    {
        $graceMinutes = max(1, (int) config('timer.live_elapsed_grace_minutes', 3));
        $cutoff = now()->subMinutes($graceMinutes);

        $liveAsOf = $this->liveAsOf($entry, $cutoff);

        return $liveAsOf->gte($cutoff) ? now() : $liveAsOf;
    }

    /**
     * Most recent evidence that the agent owning this entry is alive.
     *
     * `client_synced_at` is checked FIRST because it is a column on the row already —
     * the sync endpoint stamps it on every push of the live session, including one
     * carrying no change. Only when that is already stale do we pay for the heartbeat
     * lookup (indexed by `al_time_entry_idx`), so the healthy path costs no extra query.
     *
     * Heartbeats matter because they are far fresher: the agent POSTs one every 30s
     * while online, whereas `client_synced_at` only moves once per 10-minute upload.
     */
    private function liveAsOf(TimeEntry $entry, ?Carbon $shortCircuitAfter = null): Carbon
    {
        $liveAsOf = $entry->started_at;

        if ($entry->client_synced_at !== null && $entry->client_synced_at->gt($liveAsOf)) {
            $liveAsOf = $entry->client_synced_at;
        }

        if ($shortCircuitAfter !== null && $liveAsOf->gte($shortCircuitAfter)) {
            return $liveAsOf;
        }

        $lastHeartbeat = ActivityLog::where('time_entry_id', $entry->id)->max('logged_at');

        if ($lastHeartbeat !== null) {
            $heartbeatAt = Carbon::parse($lastHeartbeat);
            if ($heartbeatAt->gt($liveAsOf)) {
                $liveAsOf = $heartbeatAt;
            }
        }

        return $liveAsOf;
    }

    /**
     * Resolve the user's currently open timer entry from Redis, falling back to the DB
     * when the cache is missing or stale. Repairs Redis when a DB open entry is found
     * so status() stays consistent after Redis restarts or evictions.
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
     * The 'paused' state is legacy: the desktop no longer pauses server-side for idle
     * (idle is resolved locally and synced as an ordinary session split). The branch is
     * retained so a Redis key written by a pre-refactor build is still rendered
     * correctly until it expires.
     *
     * @return array<string, mixed>
     */
    private function buildOpenEntryStatus(
        TimeEntry $entry,
        int $todayTotal,
        int $allProjectsTodayTotal,
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

        // The running entry always contributes to the global all-projects sum regardless
        // of which project was requested.
        $allProjectsTodayTotal += $currentElapsed;

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

        // How far the elapsed figure can be trusted. When the agent has gone quiet the
        // clock above is frozen at `live_as_of`, and a client that keeps ticking from
        // `started_at` would re-introduce exactly the invented time the freeze removes.
        $liveAsOf = $this->liveAsOf($entry);
        $isStale = $liveAsOf->lt(now()->subMinutes(max(1, (int) config('timer.live_elapsed_grace_minutes', 3))));

        return [
            'state' => $timerState,
            'running' => ! $isPaused,
            'paused' => $isPaused,
            'entry' => $entry,
            'elapsed_seconds' => $currentElapsed,
            'live_as_of' => $liveAsOf->toISOString(),
            'elapsed_is_stale' => $isStale,
            'today_total' => $todayTotal,
            'all_projects_today_total' => $allProjectsTodayTotal,
            'project_today_total' => $projectTodayTotal,
            'current_day' => $currentDay,
            'server_time' => now()->toISOString(),
            'paused_at' => $pausedAt?->toISOString(),
            'pause_reason' => $isPaused ? ($meta['pause_reason'] ?? null) : null,
        ];
    }

    /**
     * Get timer status. "Today" is the user's current calendar day in their timezone
     * (stored as UTC in DB).
     *
     * Primary consumer is the WEB dashboard's live-tracking indicator — the desktop
     * derives its own state from local SQLite and does not adopt this.
     *
     * Field semantics (see bugs/desktop-today-total-project-scoped-when-project-selected.md):
     * - `today_total`: historical semantics — scoped to $projectId when provided, else the
     *   all-projects sum. Kept unchanged for backward compatibility with deployed clients.
     * - `all_projects_today_total`: ALWAYS the global all-projects sum (never scoped).
     * - `project_today_total`: the requested project's total (also populated in the stopped
     *   branch) so per-project displays don't need a second API call.
     */
    public function status(?string $projectId = null): array
    {
        $user = Auth::user();
        $redisKey = "timer:{$user->id}";
        $tz = $user->getTimezoneForDates();

        // Current day = user's calendar day in their timezone (00:00–23:59 local → UTC bounds for DB)
        [$todayStartUtc, $todayEndUtc] = TimezoneAwareDateRange::userTodayUtcBounds($tz);
        $currentDay = Carbon::now($tz)->toDateString();

        $baseTodayQuery = fn () => TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $todayStartUtc)
            ->where('started_at', '<', $todayEndUtc)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked');

        // Always-global sum across all projects (never scoped). Feeds the desktop
        // "Today, all projects" line and the tray "Today: X" tooltip.
        $allProjectsTodayTotal = (int) $baseTodayQuery()->sum('duration_seconds');

        // today_total keeps its historical scoped-when-project-provided semantics.
        $todayTotal = $projectId !== null
            ? (int) $baseTodayQuery()->where('project_id', $projectId)->sum('duration_seconds')
            : $allProjectsTodayTotal;

        $entry = $this->findOpenRunningEntry($user, $redisKey);
        if (! $entry) {
            return [
                'state' => 'stopped',
                'running' => false,
                'paused' => false,
                'entry' => null,
                'elapsed_seconds' => 0,
                // Nothing is open, so there is no extrapolation to qualify.
                'live_as_of' => null,
                'elapsed_is_stale' => false,
                'today_total' => $todayTotal,
                'all_projects_today_total' => $allProjectsTodayTotal,
                'project_today_total' => $projectId !== null ? $todayTotal : 0,
                'current_day' => $currentDay,
                'server_time' => now()->toISOString(),
            ];
        }

        $requestedProjectId = $projectId !== null && $projectId !== '' ? (string) $projectId : null;

        return $this->buildOpenEntryStatus(
            $entry,
            $todayTotal,
            $allProjectsTodayTotal,
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
     *
     * The desktop calls this to pick up MANUAL time entries, which it does not own and
     * therefore cannot compute from its local session store.
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

        // Add the live timer's current elapsed, but ONLY when a Redis timer key exists.
        // The Redis key is the authoritative "running" signal: an open DB entry with NO
        // Redis key is an orphan (crashed/evicted session) and must not inflate today's
        // total — resurrecting it here via a DB self-heal would add up to a full
        // max-entry-duration of phantom time. status() still self-heals Redis from the DB
        // (it owns that repair), but a pure read like todayTotal must not.
        // Regression guard: TimerServiceTest::test_today_total_excludes_running_entries_without_ended_at.
        $redisKey = "timer:{$user->id}";
        $meta = $this->getRedisTimerMeta($redisKey);
        if ($meta !== null && ! empty($meta['entry_id'])) {
            $entry = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('user_id', $user->id)
                ->whereNull('ended_at')
                ->find($meta['entry_id']);

            if ($entry && ($projectId === null || $projectId === '' || (string) $entry->project_id === (string) $projectId)) {
                $isPaused = ($meta['state'] ?? 'running') === 'paused';
                $frozenAt = $isPaused && ! empty($meta['paused_at'])
                    ? Carbon::parse($meta['paused_at'])
                    : null;
                $elapsed = $this->computeOpenEntryElapsed($entry, $frozenAt);
                $total += $elapsed;
            }
        }

        return $total;
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
        $entryId = $timerInfo['entry_id'] ?? null;

        // WHICH SESSION IS THIS HEARTBEAT FOR?
        //
        // The Redis pointer answers "which entry did the agent last tell us about",
        // which is NOT the same question once the agent tracks locally and uploads on a
        // 10-minute batch. Every local session change — an idle discard, a stop/start, a
        // project switch, the midnight split — leaves the pointer aimed at the previous
        // entry until the next push.
        //
        // Measured on dev: an entry the agent closed locally at 12:37:16 collected 25
        // heartbeats between 12:43:39 and 13:03:28, stopping the instant its successor
        // synced. Those logs spanned an idle gap and nine minutes of the NEXT session.
        // Two things break as a result: `computeFinalActivityScore()` finalises the
        // closed entry from activity that is not its own, and the fresh logs make a
        // stale entry look alive to the live-elapsed clamp — which is why the dashboard
        // kept counting a session that had already ended.
        //
        // So prefer the agent's OWN identifier for the session. `session_uuid` is the
        // client-generated `idempotency_key` the sync endpoint upserts on, so it names
        // the session unambiguously and independently of what the server last heard.
        $sessionUuid = isset($data['session_uuid']) ? (string) $data['session_uuid'] : null;

        if ($sessionUuid !== null && $sessionUuid !== '') {
            $entry = TimeEntry::withoutGlobalScope(GlobalOrganizationScope::class)
                ->where('organization_id', $user->organization_id)
                ->where('user_id', $user->id)
                ->where('idempotency_key', $sessionUuid)
                ->whereNull('ended_at')
                ->first();

            if (! $entry) {
                // The agent is demonstrably alive, but on a session this server has not
                // received yet (or one it believes is closed). Attaching the heartbeat to
                // the Redis-pointed entry is exactly the misattribution above, so refuse
                // it — the desktop queues a rejected heartbeat and replays it once the
                // owning session syncs, which is the same path offline heartbeats take.
                throw new \RuntimeException('Heartbeat is for a session that has not synced yet.');
            }
        } else {
            // No uuid: an agent build that predates this field. Keep the original
            // behaviour so it goes on working — FIX B2's rule still applies, a heartbeat
            // must never land on a CLOSED entry and mutate a finalised activity_score.
            $entry = $entryId
                ? TimeEntry::whereNull('ended_at')->find($entryId)
                : null;
        }

        if (! $entry) {
            throw new \RuntimeException('No timer is currently running.');
        }

        // FIX B2: Honor a client-supplied capture timestamp so offline-flushed
        // heartbeats land at their TRUE capture time, not the flush moment. Validated
        // against the skew window; falls back to now() when absent (backward compat).
        $rawLoggedAt = $data['logged_at'] ?? $data['captured_at'] ?? null;
        $loggedAt = $rawLoggedAt
            ? $this->parseClientTimestamp((string) $rawLoggedAt, 'logged_at')
            : now();

        $logData = [
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => $loggedAt,
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
        // $entry is the OPEN entry resolved above (never a closed one — FIX B2).
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
}
