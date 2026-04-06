<?php

namespace App\Jobs;

use App\Services\PayrollService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class RunPayrollJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 300;

    public function __construct(
        public string $periodId,
        public string $organizationId,
    ) {
        $this->onQueue('default');
    }

    public function handle(PayrollService $payrollService): void
    {
        Log::info('RunPayrollJob: processing', [
            'period_id' => $this->periodId,
            'organization_id' => $this->organizationId,
        ]);

        $period = $payrollService->runPayroll($this->periodId);

        Log::info('RunPayrollJob: completed', [
            'period_id' => $this->periodId,
            'organization_id' => $this->organizationId,
            'payslips_count' => $period->payslips_count ?? 0,
        ]);
    }

    public function backoff(): array
    {
        return [60, 120, 300];
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical('RunPayrollJob failed', [
            'period_id' => $this->periodId,
            'organization_id' => $this->organizationId,
            'error' => $exception->getMessage(),
        ]);
    }
}
