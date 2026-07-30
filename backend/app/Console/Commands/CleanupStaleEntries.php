<?php

namespace App\Console\Commands;

use App\Models\ActivityLog;
use App\Models\TimeEntry;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class CleanupStaleEntries extends Command
{
    protected $signature = 'timer:cleanup-stale';

    protected $description = 'Auto-close stale time entries with no heartbeat for the offline grace window';

    /**
     * Maximum duration (seconds) for any single time entry.
     * 12 hours = 43200 seconds. Prevents runaway timers from corrupting reports.
     */
    private const MAX_ENTRY_DURATION = 43200;

    /**
     * Number of times the command may be attempted.
     */
    public $tries = 1;

    /**
     * Maximum number of seconds the command may run.
     */
    public $timeout = 120;

    public function handle(): int
    {
        // Offline desktops queue heartbeats and flush them on reconnect, so the last
        // SERVER-received heartbeat can legitimately lag by hours. Use the offline grace
        // window (default 4h) as the staleness threshold instead of a 30-minute window
        // that would truncate legitimate offline tracking. We still close AT the last
        // heartbeat, so dead time after the last activity is never counted.
        $graceMinutes = (int) config('timer.offline_grace_minutes', 240);
        $threshold = Carbon::now()->subMinutes($graceMinutes);
        $closed = 0;
        $maxDuration = (int) config('timer.max_entry_duration', self::MAX_ENTRY_DURATION);

        // Find all running entries (ended_at IS NULL, type = tracked)
        TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->whereNull('ended_at')
            ->where('type', 'tracked')
            ->chunkById(200, function ($entries) use ($threshold, $maxDuration, &$closed) {
                // Batch-fetch last heartbeat for all entries in this chunk (avoid N+1)
                $entryIds = $entries->pluck('id');
                $lastHeartbeats = ActivityLog::whereIn('time_entry_id', $entryIds)
                    ->selectRaw('time_entry_id, MAX(logged_at) as last_heartbeat')
                    ->groupBy('time_entry_id')
                    ->pluck('last_heartbeat', 'time_entry_id');

                foreach ($entries as $entry) {
                    // Determine last activity: use the latest heartbeat (ActivityLog.logged_at)
                    $lastHeartbeat = $lastHeartbeats->get($entry->id);

                    $lastActive = $lastHeartbeat
                        ? Carbon::parse($lastHeartbeat)
                        : null;

                    // LIVENESS: `client_synced_at` is stamped on every successful agent
                    // push (~60s cadence), which makes it a far sharper signal than the
                    // last heartbeat — offline heartbeats arrive in one burst long after
                    // capture, so an agent can look silent for hours while perfectly
                    // healthy. Take the MOST RECENT evidence of life from either source;
                    // an entry is only stale when BOTH have gone quiet.
                    $lastContact = $entry->client_synced_at;
                    $referenceTime = $lastActive ?? $entry->started_at;
                    if ($lastContact !== null && $lastContact->gt($referenceTime)) {
                        $referenceTime = $lastContact;
                    }

                    // Skip while the agent is still demonstrably alive.
                    if ($referenceTime->gt($threshold)) {
                        continue;
                    }

                    // Close the stale entry AT its last known activity, never at now() —
                    // dead time after the agent went silent is discarded, not billed.
                    // client_synced_at is deliberately NOT used as the close point: it
                    // proves the agent was alive, not that the user was working.
                    $endedAt = $lastActive ?? $entry->started_at;
                    $duration = (int) abs($endedAt->diffInSeconds($entry->started_at));

                    // Cap duration to prevent runaway entries from corrupting reports
                    $duration = min($duration, $maxDuration);
                    if ($duration === $maxDuration) {
                        $endedAt = $entry->started_at->copy()->addSeconds($maxDuration);
                    }

                    $entry->update([
                        'ended_at' => $endedAt,
                        'duration_seconds' => $duration,
                    ]);

                    // Clear the Redis timer key for this user
                    $redisKey = "timer:{$entry->user_id}";
                    Redis::del($redisKey);

                    Log::info("[cleanup] Auto-closed stale entry {$entry->id} for user {$entry->user_id}, duration: {$duration}s, last active: {$referenceTime->toISOString()}");
                    $closed++;
                }
            });

        $this->info("Cleaned up {$closed} stale time entries.");

        return Command::SUCCESS;
    }
}
