<?php

namespace App\Jobs;

use App\Services\CheckInService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Backstop that flags forgotten check-ins (open sessions whose org-local day is
 * already past) as missing_checkout for later regularization.
 *
 * NOTE: the Laravel scheduler is DISABLED on dev and only runs in prod — do not
 * rely on the schedule firing in tests; test autoCloseStaleCheckIns() directly.
 */
class CloseStaleCheckInsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 300;

    public function __construct(
        public string $organizationId,
    ) {
        $this->onQueue('default');
    }

    public function handle(CheckInService $checkInService): void
    {
        $count = $checkInService->autoCloseStaleCheckIns($this->organizationId);

        Log::info('CloseStaleCheckInsJob: completed', [
            'organization_id' => $this->organizationId,
            'closed' => $count,
        ]);
    }

    public function backoff(): array
    {
        return [60, 120, 300];
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical('CloseStaleCheckInsJob failed', [
            'organization_id' => $this->organizationId,
            'error' => $exception->getMessage(),
        ]);
    }
}
