<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Horizon\Contracts\MasterSupervisorRepository;

class JobMonitorController extends Controller
{
    /**
     * GET /jobs/health — returns status of all scheduled cron jobs.
     *
     * Shows: scheduler heartbeat, pending/failed jobs, daily summary status, Horizon status.
     */
    public function health(Request $request): JsonResponse
    {
        // 1. Check failed_jobs table for recent failures (last 48 hours)
        $failedJobs = DB::table('failed_jobs')
            ->where('failed_at', '>', now()->subHours(48))
            ->select('uuid', 'queue', 'payload', 'failed_at')
            ->orderByDesc('failed_at')
            ->limit(20)
            ->get()
            ->map(function ($job) {
                $payload = json_decode($job->payload);

                return [
                    'id' => $job->uuid,
                    'job' => $payload->displayName ?? 'Unknown',
                    'queue' => $job->queue,
                    'failed_at' => $job->failed_at,
                ];
            });

        // 2. Count pending jobs in queue
        $pendingJobCount = DB::table('jobs')->count();

        // 3. Check if daily activity summary completed for the relevant date
        //    If it's after 23:00, check today; otherwise check yesterday (job runs at 23:00)
        $checkDate = now()->hour >= 23 ? now()->toDateString() : now()->subDay()->toDateString();

        $orgId = $request->user()->organization_id;
        $activitySummaryMarker = Cache::get("job:daily_activity_summary:{$checkDate}:{$orgId}");

        // 4. Scheduler heartbeat: check if scheduler ran within the last 5 minutes
        $lastSchedulerRun = Cache::get('scheduler:last_run');
        $schedulerHealthy = $lastSchedulerRun !== null;

        // 5. Horizon master supervisor status
        $horizonStatus = 'stopped';
        try {
            $master = app(MasterSupervisorRepository::class)->all();
            $horizonStatus = !empty($master) ? 'running' : 'stopped';
        } catch (\Throwable $e) {
            $horizonStatus = 'unknown';
        }

        return response()->json([
            'scheduler_healthy' => $schedulerHealthy,
            'scheduler_last_run' => $lastSchedulerRun,
            'pending_jobs' => $pendingJobCount,
            'failed_jobs_48h' => $failedJobs,
            'daily_activity_summary' => [
                'check_date' => $checkDate,
                'completed' => !is_null($activitySummaryMarker),
                'details' => $activitySummaryMarker,
            ],
            'horizon_status' => $horizonStatus,
        ]);
    }

    /**
     * POST /jobs/retry/{id} — retry a failed job by UUID.
     */
    public function retry(Request $request, string $id): JsonResponse
    {
        $job = DB::table('failed_jobs')->where('uuid', $id)->first();

        if (!$job) {
            return response()->json(['message' => 'Failed job not found.'], 404);
        }

        Artisan::call('queue:retry', ['id' => [$id]]);

        return response()->json(['message' => 'Job queued for retry.']);
    }
}
