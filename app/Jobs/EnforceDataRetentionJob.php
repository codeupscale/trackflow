<?php

namespace App\Jobs;

use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\ActivityLog;
use App\Models\AuditLog;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class EnforceDataRetentionJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct()
    {
        $this->queue = 'low';
    }

    public function handle(): void
    {
        Organization::query()->chunk(50, function ($orgs) {
            foreach ($orgs as $org) {
                $this->enforceForOrganization($org);
            }
        });

        // Global: prune audit logs older than 2 years
        $auditDeleted = AuditLog::where('created_at', '<', now()->subYears(2))->delete();
        if ($auditDeleted > 0) {
            Log::info('data_retention.audit_logs_pruned', ['count' => $auditDeleted]);
        }
    }

    private function enforceForOrganization(Organization $org): void
    {
        $config = $org->data_retention_config ?? [];
        $screenshotDays = $config['screenshot_retention_days'] ?? 180;
        $activityDays = $config['activity_log_retention_days'] ?? 90;

        // Delete old screenshots
        $oldScreenshots = Screenshot::where('organization_id', $org->id)
            ->where('captured_at', '<', now()->subDays($screenshotDays))
            ->get();

        foreach ($oldScreenshots as $screenshot) {
            Storage::disk('s3')->delete("screenshots/{$screenshot->s3_key}");
            if ($screenshot->thumbnail_key) {
                Storage::disk('s3')->delete("screenshots/{$screenshot->thumbnail_key}");
            }
            $screenshot->delete();
        }

        if ($oldScreenshots->count() > 0) {
            Log::info('data_retention.screenshots_pruned', [
                'org_id' => $org->id,
                'count' => $oldScreenshots->count(),
                'retention_days' => $screenshotDays,
            ]);
        }

        // Delete old activity logs
        $activityDeleted = ActivityLog::where('organization_id', $org->id)
            ->where('created_at', '<', now()->subDays($activityDays))
            ->delete();

        if ($activityDeleted > 0) {
            Log::info('data_retention.activity_logs_pruned', [
                'org_id' => $org->id,
                'count' => $activityDeleted,
                'retention_days' => $activityDays,
            ]);
        }
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('data_retention.job_failed', [
            'error' => $exception->getMessage(),
        ]);
    }
}
