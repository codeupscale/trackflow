<?php

namespace App\Jobs;

use App\Services\ReportService;
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
                $content = $this->generateCsv($data);
                $filename = "reports/{$this->orgId}/{$this->jobId}.csv";
            } else {
                $content = $this->generatePdf($data);
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

    private function generateCsv(array $data): string
    {
        $output = fopen('php://temp', 'r+');

        // Flatten the data into CSV rows
        if (isset($data['daily'])) {
            fputcsv($output, ['Date', 'Total Seconds', 'Activity Score', 'Entry Count']);
            foreach ($data['daily'] as $row) {
                fputcsv($output, [
                    $row->date ?? $row['date'] ?? '',
                    $row->total_seconds ?? $row['total_seconds'] ?? 0,
                    $row->activity_score_avg ?? $row['activity_score_avg'] ?? 0,
                    $row->entry_count ?? $row['entry_count'] ?? 0,
                ]);
            }
        } elseif (isset($data['team'])) {
            fputcsv($output, ['Name', 'Email', 'Total Seconds', 'Activity Score', 'Entries']);
            foreach ($data['team'] as $row) {
                fputcsv($output, [
                    $row['user']['name'],
                    $row['user']['email'],
                    $row['total_seconds'],
                    $row['avg_activity'],
                    $row['entry_count'],
                ]);
            }
        } elseif (isset($data['payroll'])) {
            fputcsv($output, ['Name', 'Email', 'Total Hours', 'Billable Hours', 'Earnings']);
            foreach ($data['payroll'] as $row) {
                fputcsv($output, [
                    $row['user']['name'],
                    $row['user']['email'],
                    $row['total_hours'],
                    $row['billable_hours'],
                    $row['earnings'],
                ]);
            }
        } else {
            // Generic: encode as JSON rows
            fputcsv($output, array_keys(is_array($data) && count($data) > 0 ? (is_array($data[0]) ? $data[0] : (array)$data[0]) : []));
            foreach ($data as $row) {
                fputcsv($output, is_array($row) ? $row : (array)$row);
            }
        }

        rewind($output);
        $csv = stream_get_contents($output);
        fclose($output);
        return $csv;
    }

    private function generatePdf(array $data): string
    {
        if (class_exists(\Barryvdh\DomPDF\Facade\Pdf::class)) {
            $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('reports.generic', [
                'type' => $this->type,
                'data' => $data,
                'dateFrom' => $this->dateFrom,
                'dateTo' => $this->dateTo,
            ]);
            return $pdf->output();
        }

        // Fallback: simple HTML to text
        return json_encode($data, JSON_PRETTY_PRINT);
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
