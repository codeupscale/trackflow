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
        TimeEntry::withoutGlobalScopes()
            ->whereNull('ended_at')
            ->where('type', 'tracked')
            ->chunkById(200, function ($entries) use ($threshold, &$closed) {
                foreach ($entries as $entry) {
                    // Determine last activity: use the latest heartbeat (ActivityLog.logged_at)
                    $lastHeartbeat = ActivityLog::where('time_entry_id', $entry->id)
                        ->orderByDesc('logged_at')
                        ->value('logged_at');

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

                    $entry->update([
                        'ended_at' => $endedAt,
                        'duration_seconds' => $duration,
                    ]);

                    // Clear the Redis timer key for this user
                    $redisKey = "timer:{$entry->user_id}";
                    Redis::del($redisKey);

                    Log::info("[cleanup] Auto-closed stale entry {$entry->id} for user {$entry->user_id}, last active: {$referenceTime->toISOString()}");
                    $closed++;
                }
            });

        $this->info("Cleaned up {$closed} stale time entries.");

        return Command::SUCCESS;
    }
}
