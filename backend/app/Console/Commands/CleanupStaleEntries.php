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

    protected $description = 'Auto-close stale time entries that have no heartbeat for 30+ minutes';

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
        $threshold = Carbon::now()->subMinutes(30);
        $closed = 0;

        // Find all running entries (ended_at IS NULL, type = tracked)
        TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->whereNull('ended_at')
            ->where('type', 'tracked')
            ->chunkById(200, function ($entries) use ($threshold, &$closed) {
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

                    // If no heartbeat exists, use started_at as the reference
                    $referenceTime = $lastActive ?? $entry->started_at;

                    // Skip if still within the 30-minute threshold
                    if ($referenceTime->gt($threshold)) {
                        continue;
                    }

                    // Close the stale entry: set ended_at to last known activity
                    $endedAt = $lastActive ?? $entry->started_at;
                    $duration = (int) abs($endedAt->diffInSeconds($entry->started_at));

                    // Cap duration to prevent runaway entries from corrupting reports
                    $duration = min($duration, self::MAX_ENTRY_DURATION);
                    if ($duration === self::MAX_ENTRY_DURATION) {
                        $endedAt = $entry->started_at->copy()->addSeconds(self::MAX_ENTRY_DURATION);
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
