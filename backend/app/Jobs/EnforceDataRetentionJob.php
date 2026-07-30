<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\AuditLog;
use App\Models\Organization;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Nightly data-retention enforcement (scheduled 04:00 UTC in routes/console.php).
 *
 * Two responsibilities:
 *   1. Per-org activity-log pruning for orgs that OPT IN via
 *      `data_retention_config.activity_log_retention_days`.
 *   2. Global audit-log pruning at 2 years.
 *
 * ACTIVITY-LOG OWNERSHIP: the default 90-day activity-log prune is owned by
 * PruneOldActivityLogsJob (scheduled 02:00, dispatched per org). That job also
 * carries the plan policy — `pro` orgs get unlimited retention and are skipped.
 * This job therefore prunes activity logs ONLY when the org sets an explicit
 * retention window, so it can never override that exemption and silently delete a
 * pro org's history. An org with no `data_retention_config` is left entirely to
 * the 02:00 job.
 *
 * Screenshot deletion is disabled system-wide — screenshots are retained
 * indefinitely and are intentionally never pruned by data retention.
 */
class EnforceDataRetentionJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 600;

    public array $backoff = [60, 300, 900];

    /** Rows deleted per statement, so a large backlog never holds one long lock. */
    private const DELETE_CHUNK = 1000;

    public function __construct()
    {
        $this->queue = 'low';
    }

    public function handle(): void
    {
        Organization::query()->withoutGlobalScopes()->chunkById(50, function ($orgs) {
            foreach ($orgs as $org) {
                // One malformed org must not abort the whole sweep — and must not
                // skip the audit prune below, which is what happened while this job
                // was failing on every run.
                try {
                    $this->enforceForOrganization($org);
                } catch (\Throwable $e) {
                    Log::error('data_retention.org_failed', [
                        'org_id' => $org->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        });

        // Global: prune audit logs older than 2 years. Runs in system context, so the
        // org scope is bypassed explicitly rather than relying on there being no
        // authenticated user.
        $auditDeleted = $this->deleteInChunks(
            fn () => AuditLog::withoutGlobalScopes()
                ->where('created_at', '<', now()->subYears(2))
                ->limit(self::DELETE_CHUNK)
                ->delete()
        );

        if ($auditDeleted > 0) {
            Log::info('data_retention.audit_logs_pruned', ['count' => $auditDeleted]);
        }
    }

    private function enforceForOrganization(Organization $org): void
    {
        $config = $org->data_retention_config ?? [];
        $activityDays = $config['activity_log_retention_days'] ?? null;

        // No explicit window — PruneOldActivityLogsJob (02:00) owns this org.
        if ($activityDays === null) {
            return;
        }

        $activityDays = (int) $activityDays;
        if ($activityDays < 1) {
            Log::warning('data_retention.invalid_retention_days', [
                'org_id' => $org->id,
                'value' => $config['activity_log_retention_days'],
            ]);

            return;
        }

        // `activity_logs` has no created_at/updated_at (ActivityLog sets
        // $timestamps = false) — `logged_at` is the only time column, and it is the
        // one the (organization_id, logged_at) index covers.
        $cutoff = now()->subDays($activityDays);

        $activityDeleted = $this->deleteInChunks(
            fn () => ActivityLog::withoutGlobalScopes()
                ->where('organization_id', $org->id)
                ->where('logged_at', '<', $cutoff)
                ->limit(self::DELETE_CHUNK)
                ->delete()
        );

        if ($activityDeleted > 0) {
            Log::info('data_retention.activity_logs_pruned', [
                'org_id' => $org->id,
                'count' => $activityDeleted,
                'retention_days' => $activityDays,
            ]);
        }
    }

    /**
     * Run a limited delete repeatedly until it stops matching rows, returning the
     * total. Keeps a multi-hundred-thousand-row backlog from being attempted as one
     * statement.
     */
    private function deleteInChunks(callable $delete): int
    {
        $total = 0;

        do {
            $batch = (int) $delete();
            $total += $batch;
        } while ($batch > 0);

        return $total;
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('data_retention.job_failed', [
            'error' => $exception->getMessage(),
        ]);
    }
}
