<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\Organization;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class PruneOldActivityLogsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 300;

    public function __construct(
        public string $organizationId
    ) {
        $this->onQueue('low');
    }

    public function handle(): void
    {
        $organization = Organization::findOrFail($this->organizationId);

        // Pro plan has unlimited retention; only prune for starter plan
        if ($organization->plan === 'pro') {
            return;
        }

        // Starter plan: 90-day retention
        $retentionDays = 90;
        $cutoff = now()->subDays($retentionDays);

        // Delete in chunks to avoid memory issues
        $deleted = 0;
        do {
            $batch = ActivityLog::withoutGlobalScopes()
                ->where('organization_id', $this->organizationId)
                ->where('logged_at', '<', $cutoff)
                ->limit(1000)
                ->delete();

            $deleted += $batch;
        } while ($batch > 0);

        if ($deleted > 0) {
            \Illuminate\Support\Facades\Log::info("Pruned {$deleted} activity logs for organization {$this->organizationId}");
        }
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function failed(\Throwable $exception): void
    {
        \Illuminate\Support\Facades\Log::critical("PruneOldActivityLogsJob failed for org {$this->organizationId}", [
            'error' => $exception->getMessage(),
        ]);
    }
}
