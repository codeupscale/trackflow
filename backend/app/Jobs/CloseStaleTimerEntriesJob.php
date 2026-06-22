<?php
namespace App\Jobs;

use App\Models\TimeEntry;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class CloseStaleTimerEntriesJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 120;

    public function backoff(): array
    {
        return [30, 120, 300];
    }

    public function handle(): void
    {
        // Longer backstop than the timer:cleanup-stale command. It MUST be at least the
        // offline grace window (default 4h) plus a margin, otherwise it would force-close
        // running entries while their offline-queued heartbeats are still in flight and
        // truncate legitimate offline work. Default: grace + 60 minutes.
        $graceMinutes = (int) config('timer.offline_grace_minutes', 240);
        $backstopThreshold = now()->subMinutes($graceMinutes + 60);

        $staleEntries = TimeEntry::whereNull('ended_at')
            ->where('updated_at', '<', $backstopThreshold)
            ->get();

        foreach ($staleEntries as $entry) {
            $closedAt = $entry->updated_at;
            $duration = (int) abs($closedAt->diffInSeconds($entry->started_at));
            $entry->update([
                'ended_at' => $closedAt,
                'duration_seconds' => min($duration, 43200),
            ]);
            Log::warning('CloseStaleTimerEntriesJob: closed stale entry', [
                'entry_id' => $entry->id,
                'user_id' => $entry->user_id,
                'started_at' => $entry->started_at,
                'auto_closed_at' => $closedAt,
            ]);
        }

        Log::info('CloseStaleTimerEntriesJob: processed ' . count($staleEntries) . ' stale entries');
    }

    public function failed(\Throwable $e): void
    {
        Log::error('CloseStaleTimerEntriesJob failed', [
            'error' => $e->getMessage(),
        ]);
    }
}
