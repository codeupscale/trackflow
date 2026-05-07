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

    public function handle(): void
    {
        $staleEntries = TimeEntry::whereNull('ended_at')
            ->where('updated_at', '<', now()->subHours(2))
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
}
