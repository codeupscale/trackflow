<?php

namespace App\Jobs;

use App\Mail\DailyActivitySummary;
use App\Models\Organization;
use App\Services\DailyActivitySummaryService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class SendDailyActivitySummaryJob implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 300;

    public function __construct(
        public string $organizationId,
        public string $date
    ) {
        $this->onQueue('default');
    }

    /**
     * Unique ID prevents duplicate dispatches for the same org + date.
     */
    public function uniqueId(): string
    {
        return $this->organizationId . ':' . $this->date;
    }

    public function handle(DailyActivitySummaryService $service): void
    {
        $organization = Organization::find($this->organizationId);

        if (! $organization) {
            Log::warning("SendDailyActivitySummaryJob: organization {$this->organizationId} not found, skipping.");
            return;
        }

        $dashboardUrl = rtrim(config('app.frontend_url', config('app.url')), '/') . '/reports';

        $users = $service->getEligibleUsers($this->organizationId);

        $emailsSent = 0;
        $emailsSkipped = 0;

        foreach ($users as $user) {
            try {
                $summary = $service->getUserDailySummary(
                    $this->organizationId,
                    $user->id,
                    $this->date
                );

                // Skip users with zero tracked time — no point emailing "0 hours"
                if ($summary['total_seconds'] === 0) {
                    $emailsSkipped++;
                    continue;
                }

                Mail::to($user->email)->queue(
                    new DailyActivitySummary(
                        employeeName: $user->name,
                        date: $this->date,
                        totalSeconds: $summary['total_seconds'],
                        trackedSeconds: $summary['tracked_seconds'],
                        idleSeconds: $summary['idle_seconds'],
                        activityPercentage: $summary['activity_percentage'],
                        projects: $summary['projects'],
                        organizationName: $organization->name,
                        dashboardUrl: $dashboardUrl,
                    )
                );

                $emailsSent++;
            } catch (\Throwable $e) {
                Log::error("SendDailyActivitySummaryJob: failed to send email to {$user->email}", [
                    'organization_id' => $this->organizationId,
                    'user_id' => $user->id,
                    'error' => $e->getMessage(),
                ]);
                // Continue with next user — don't let one failure block the entire org
            }
        }

        // Store completion marker so the self-check scheduler and /jobs/health can verify this ran
        Cache::put(
            "job:daily_activity_summary:{$this->date}:{$this->organizationId}",
            [
                'completed_at' => now()->toIso8601String(),
                'emails_sent' => $emailsSent,
                'emails_skipped' => $emailsSkipped,
            ],
            now()->addDays(7)
        );
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical("SendDailyActivitySummaryJob failed for org {$this->organizationId}", [
            'date' => $this->date,
            'error' => $exception->getMessage(),
        ]);
    }
}
