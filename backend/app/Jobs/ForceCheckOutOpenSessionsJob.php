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
 * Feature B (owner request 2026-07-23): at the org-local midnight, force a checkout
 * on every OPEN check-in session left over from a day that has already ended, stamping
 * check_out_at at the user's last tracked activity on that day (falling back to the
 * policy checkout_time). Distinct from CloseStaleCheckInsJob, which only FLAGS a
 * missing checkout and leaves the session open.
 *
 * NOTE: the Laravel scheduler is DISABLED on dev and only runs in prod — do not rely on
 * the schedule firing in tests; test autoCheckOutOpenSessions() directly.
 */
class ForceCheckOutOpenSessionsJob implements ShouldQueue
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
        $count = $checkInService->autoCheckOutOpenSessions($this->organizationId);

        Log::info('ForceCheckOutOpenSessionsJob: completed', [
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
        Log::critical('ForceCheckOutOpenSessionsJob failed', [
            'organization_id' => $this->organizationId,
            'error' => $exception->getMessage(),
        ]);
    }
}
