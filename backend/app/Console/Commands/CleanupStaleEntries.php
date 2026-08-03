<?php

namespace App\Console\Commands;

use App\Services\TimeEntrySyncService;
use Illuminate\Console\Command;

/**
 * Close time entries abandoned by an agent that is never coming back.
 *
 * Thin by design — the logic lives in TimeEntrySyncService::closeAbandonedOpenEntries(),
 * which is also the single implementation this project has for the job. It used to be
 * duplicated here and in CloseStaleTimerEntriesJob (now deleted), and the two disagreed
 * on the most important detail: this one closes at the last HEARTBEAT (evidence of
 * work), while the other closed at `updated_at` (evidence the agent was alive), which
 * bills every dead minute between the user's last input and the agent's last push.
 */
class CleanupStaleEntries extends Command
{
    protected $signature = 'timer:cleanup-stale
                            {--minutes= : Override the abandoned window (default: timer.abandoned_after_minutes)}';

    protected $description = 'Close open time entries whose agent has gone silent, at their last known activity';

    public $tries = 1;

    public $timeout = 120;

    public function handle(TimeEntrySyncService $sync): int
    {
        $minutes = $this->option('minutes') !== null ? (int) $this->option('minutes') : null;

        $closed = $sync->closeAbandonedOpenEntries(null, $minutes);

        $this->info("Cleaned up {$closed} stale time entries.");

        return Command::SUCCESS;
    }
}
