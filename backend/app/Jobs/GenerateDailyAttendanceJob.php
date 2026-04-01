<?php

namespace App\Jobs;

use App\Services\AttendanceService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class GenerateDailyAttendanceJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 300;

    public function __construct(
        public string $organizationId,
        public ?string $date = null,
    ) {
        $this->onQueue('default');
    }

    public function handle(AttendanceService $attendanceService): void
    {
        $date = $this->date ?? now()->subDay()->toDateString();

        Log::info('GenerateDailyAttendanceJob: processing', [
            'organization_id' => $this->organizationId,
            'date' => $date,
        ]);

        $count = $attendanceService->generateDailyAttendance($this->organizationId, $date);

        Log::info('GenerateDailyAttendanceJob: completed', [
            'organization_id' => $this->organizationId,
            'date' => $date,
            'users_processed' => $count,
        ]);
    }

    public function backoff(): array
    {
        return [60, 120, 300];
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical('GenerateDailyAttendanceJob failed', [
            'organization_id' => $this->organizationId,
            'date' => $this->date,
            'error' => $exception->getMessage(),
        ]);
    }
}
