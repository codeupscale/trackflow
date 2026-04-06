<?php

use App\Jobs\GenerateDailyAttendanceJob;
use App\Jobs\PruneOldActivityLogsJob;
use App\Jobs\SendDailyActivitySummaryJob;
use App\Jobs\SendTimerIdleAlertJob;
use App\Jobs\SendTimesheetReminderJob;
use App\Models\Organization;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;

// JOB-02: Check for idle employees — every 5 minutes
Schedule::call(function () {
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) {
            foreach ($orgs as $org) {
                SendTimerIdleAlertJob::dispatch($org->id);
            }
        });
})->everyFiveMinutes()->name('idle-detection');

// JOB-04: Timesheet reminders — Friday 4pm
Schedule::call(function () {
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) {
            foreach ($orgs as $org) {
                SendTimesheetReminderJob::dispatch(
                    $org->id,
                    now()->startOfWeek()->toDateString()
                );
            }
        });
})->weeklyOn(5, '16:00')->name('timesheet-reminders');

// JOB-06: Prune old activity logs — Daily 2am UTC
Schedule::call(function () {
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) {
            foreach ($orgs as $org) {
                PruneOldActivityLogsJob::dispatch($org->id);
            }
        });
})->dailyAt('02:00')->name('prune-activity-logs');

// Clean up expired invitations — Daily 3am UTC
Schedule::call(function () {
    \App\Models\Invitation::withoutGlobalScopes()
        ->whereNull('accepted_at')
        ->where('expires_at', '<', now())
        ->delete();
})->dailyAt('03:00')->name('clean-expired-invitations');

// JOB-07: Cleanup stale time entries — every 5 minutes
// Auto-closes running entries with no heartbeat for 30+ minutes (orphaned timers)
Schedule::command('timer:cleanup-stale')->everyFiveMinutes()->name('cleanup-stale-entries');

// JOB-08: Daily activity summary emails — weekdays (Mon-Fri) at 23:00 UTC
// Dispatches one job per organization; each job queries that org's employees and queues individual emails.
// Note: runs at 23:00 (not 23:59) to avoid scheduler timing edge cases.
Schedule::call(function () {
    $today = now()->toDateString();
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) use ($today) {
            foreach ($orgs as $org) {
                SendDailyActivitySummaryJob::dispatch($org->id, $today);
            }
        });
})->weekdays()->dailyAt('23:00')->name('daily-activity-summary');

// JOB-09: Generate daily attendance records — Daily 00:30 UTC (processes previous calendar day)
Schedule::call(function () {
    $yesterday = now()->subDay()->toDateString();
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) use ($yesterday) {
            foreach ($orgs as $org) {
                GenerateDailyAttendanceJob::dispatch($org->id, $yesterday);
            }
        });
})->dailyAt('00:30')->name('generate-daily-attendance');

// Data retention enforcement — Daily 4am UTC
Schedule::job(new \App\Jobs\EnforceDataRetentionJob)->dailyAt('04:00')->name('enforce-data-retention');

// Scheduler heartbeat — proves the scheduler process is alive.
// The /jobs/health endpoint checks this marker to report scheduler status.
Schedule::call(function () {
    Cache::put('scheduler:last_run', now()->toIso8601String(), 300); // 5 min TTL
})->everyMinute()->name('scheduler-heartbeat');

// Self-check: verify daily activity summary ran for every org, re-dispatch if missed.
// The main job fires at 23:00. This check runs at 23:30 as a safety net.
Schedule::call(function () {
    $today = now()->toDateString();
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) use ($today) {
            foreach ($orgs as $org) {
                $marker = Cache::get("job:daily_activity_summary:{$today}:{$org->id}");
                if (!$marker) {
                    Log::warning("Daily activity summary missed for org {$org->id} on {$today}, re-dispatching");
                    SendDailyActivitySummaryJob::dispatch($org->id, $today);
                }
            }
        });
})->weekdays()->dailyAt('23:30')->name('daily-activity-summary-check');
