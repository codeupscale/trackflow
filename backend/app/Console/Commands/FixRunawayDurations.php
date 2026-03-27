<?php

namespace App\Console\Commands;

use App\Models\ActivityLog;
use App\Models\TimeEntry;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class FixRunawayDurations extends Command
{
    protected $signature = 'timer:fix-runaway-durations
        {--max-hours=12 : Maximum allowed duration in hours per entry}
        {--dry-run : Show what would be fixed without making changes}';

    protected $description = 'Fix time entries with impossible durations (>max-hours) and close any still-open entries older than 24 hours';

    public function handle(): int
    {
        $maxHours = (int) $this->option('max-hours');
        $maxSeconds = $maxHours * 3600;
        $dryRun = $this->option('dry-run');

        if ($dryRun) {
            $this->warn('DRY RUN — no changes will be made.');
        }

        $this->info("Max allowed duration: {$maxHours} hours ({$maxSeconds} seconds)");
        $this->newLine();

        // Phase 1: Close entries that are still open (ended_at IS NULL) and started > 24h ago
        $this->info('Phase 1: Closing orphaned open entries (started > 24h ago)...');
        $orphanedClosed = 0;

        TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->whereNull('ended_at')
            ->where('started_at', '<', Carbon::now()->subHours(24))
            ->chunkById(200, function ($entries) use (&$orphanedClosed, $dryRun, $maxSeconds) {
                // Batch-fetch last heartbeats
                $entryIds = $entries->pluck('id');
                $lastHeartbeats = ActivityLog::whereIn('time_entry_id', $entryIds)
                    ->selectRaw('time_entry_id, MAX(logged_at) as last_heartbeat')
                    ->groupBy('time_entry_id')
                    ->pluck('last_heartbeat', 'time_entry_id');

                foreach ($entries as $entry) {
                    $lastHeartbeat = $lastHeartbeats->get($entry->id);
                    $endedAt = $lastHeartbeat ? Carbon::parse($lastHeartbeat) : $entry->started_at;

                    // Cap duration to max
                    $duration = min(
                        (int) abs($endedAt->diffInSeconds($entry->started_at)),
                        $maxSeconds
                    );

                    // If no heartbeat, set a minimal duration (the entry was started but never tracked)
                    if (!$lastHeartbeat) {
                        $endedAt = $entry->started_at->copy()->addSeconds(min($duration, 60));
                        $duration = min($duration, 60);
                    }

                    $this->line("  [{$entry->id}] user={$entry->user_id} started={$entry->started_at} -> ended_at={$endedAt} duration={$duration}s");

                    if (!$dryRun) {
                        $entry->update([
                            'ended_at' => $endedAt,
                            'duration_seconds' => $duration,
                        ]);

                        // Clear Redis timer if it points to this entry
                        $redisKey = "timer:{$entry->user_id}";
                        $timerData = Redis::get($redisKey);
                        if ($timerData) {
                            $data = json_decode($timerData, true);
                            if (($data['entry_id'] ?? null) === $entry->id) {
                                Redis::del($redisKey);
                            }
                        }
                    }

                    $orphanedClosed++;
                }
            });

        $this->info("  Orphaned entries closed: {$orphanedClosed}");
        $this->newLine();

        // Phase 2: Cap closed entries with duration_seconds > max
        $this->info("Phase 2: Capping entries with duration > {$maxHours}h...");
        $capped = 0;

        TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->whereNotNull('ended_at')
            ->where('duration_seconds', '>', $maxSeconds)
            ->chunkById(200, function ($entries) use (&$capped, $dryRun, $maxSeconds) {
                foreach ($entries as $entry) {
                    $oldDuration = $entry->duration_seconds;
                    $newEndedAt = $entry->started_at->copy()->addSeconds($maxSeconds);

                    $this->line("  [{$entry->id}] user={$entry->user_id} duration {$oldDuration}s -> {$maxSeconds}s (was " . round($oldDuration / 3600, 1) . "h)");

                    if (!$dryRun) {
                        $entry->update([
                            'ended_at' => $newEndedAt,
                            'duration_seconds' => $maxSeconds,
                        ]);
                    }

                    $capped++;
                }
            });

        $this->info("  Entries capped: {$capped}");
        $this->newLine();

        // Phase 3: Fix entries where duration_seconds doesn't match ended_at - started_at
        $this->info('Phase 3: Fixing duration_seconds mismatches...');
        $mismatches = 0;

        TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->whereNotNull('ended_at')
            ->whereNotNull('started_at')
            ->whereRaw('ABS(duration_seconds - EXTRACT(EPOCH FROM (ended_at - started_at))) > 60')
            ->where('duration_seconds', '>', $maxSeconds)
            ->chunkById(200, function ($entries) use (&$mismatches, $dryRun, $maxSeconds) {
                foreach ($entries as $entry) {
                    $actualDuration = min(
                        (int) abs($entry->ended_at->diffInSeconds($entry->started_at)),
                        $maxSeconds
                    );

                    if ($actualDuration !== $entry->duration_seconds) {
                        $this->line("  [{$entry->id}] stored={$entry->duration_seconds}s actual={$actualDuration}s");

                        if (!$dryRun) {
                            $entry->update(['duration_seconds' => $actualDuration]);
                        }

                        $mismatches++;
                    }
                }
            });

        $this->info("  Mismatches fixed: {$mismatches}");
        $this->newLine();

        $total = $orphanedClosed + $capped + $mismatches;
        $this->info("Total entries affected: {$total}");

        if ($dryRun && $total > 0) {
            $this->warn('Run without --dry-run to apply these changes.');
        }

        Log::info("[fix-runaway] Completed: orphaned={$orphanedClosed}, capped={$capped}, mismatches={$mismatches}");

        return Command::SUCCESS;
    }
}
