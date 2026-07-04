<?php

namespace App\Jobs;

use App\Services\ReportService;
use App\Support\ReportExportFormatter;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

class GenerateReportJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 2;
    public $timeout = 300;

    public function __construct(
        public string $jobId,
        public string $orgId,
        public string $userId,
        public string $type,
        public string $format,
        public string $dateFrom,
        public string $dateTo
    ) {
        $this->onQueue('default');
    }

    public function handle(ReportService $reportService): void
    {
        Cache::put("job:{$this->jobId}:status", 'processing', 3600);

        try {
            // Get report data
            $data = match ($this->type) {
                'summary' => $reportService->summary($this->orgId, null, $this->dateFrom, $this->dateTo),
                'team' => $reportService->team($this->orgId, $this->dateFrom, $this->dateTo),
                'projects' => $reportService->projects($this->orgId, $this->dateFrom, $this->dateTo),
                'payroll' => $reportService->payroll($this->orgId, $this->dateFrom, $this->dateTo),
                'attendance' => $reportService->attendance($this->orgId, $this->dateFrom, $this->dateTo),
            };

            if ($this->format === 'csv') {
                $content = ReportExportFormatter::csv($this->type, $data);
                $filename = "reports/{$this->orgId}/{$this->jobId}.csv";
            } else {
                $content = ReportExportFormatter::pdf($this->type, $data, $this->dateFrom, $this->dateTo);
                $filename = "reports/{$this->orgId}/{$this->jobId}.pdf";
            }

            Storage::disk('s3')->put($filename, $content);

            $downloadUrl = Storage::disk('s3')->temporaryUrl($filename, now()->addHours(24));

            Cache::put("job:{$this->jobId}:status", 'completed', 3600);
            Cache::put("job:{$this->jobId}:url", $downloadUrl, 3600);
        } catch (\Throwable $e) {
            Cache::put("job:{$this->jobId}:status", 'failed', 3600);
            Cache::put("job:{$this->jobId}:error", $e->getMessage(), 3600);
            throw $e;
        }
    }

    public function backoff(): array
    {
        return [60, 300];
    }

    public function failed(\Throwable $exception): void
    {
        \Illuminate\Support\Facades\Cache::put("job:{$this->jobId}:status", 'failed', 3600);
        \Illuminate\Support\Facades\Cache::put("job:{$this->jobId}:error", $exception->getMessage(), 3600);
        \Illuminate\Support\Facades\Log::critical("GenerateReportJob failed", [
            'job_id' => $this->jobId,
            'org_id' => $this->orgId,
            'error' => $exception->getMessage(),
        ]);
    }
}
