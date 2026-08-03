<?php

use App\Jobs\CloseStaleCheckInsJob;
use App\Jobs\ForceCheckOutOpenSessionsJob;
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
// Close entries abandoned by an agent that is never coming back (reimaged, stolen,
// permanently offline). Window: timer.abandoned_after_minutes (60). Liveness is the
// most recent of the last heartbeat and `client_synced_at`, so an agent that is merely
// offline — whose heartbeats arrive in a burst later — is never treated as abandoned.
// Closes at the last heartbeat, never at now().
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

// Backstop: flag forgotten check-ins (open sessions whose org-local day is past)
// as missing_checkout. Runs alongside the daily attendance generation.
// NOTE: the Laravel scheduler is DISABLED on dev and only runs in prod — do not
// rely on this firing in tests; test autoCloseStaleCheckIns() directly.
Schedule::call(function () {
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) {
            foreach ($orgs as $org) {
                CloseStaleCheckInsJob::dispatch($org->id);
            }
        });
})->dailyAt('03:00')->name('close-stale-check-ins');

// Feature B: force-checkout open check-in sessions at 00:00 Asia/Karachi (= 19:00 UTC).
// Stamps a real check_out_at (last tracked activity, else policy checkout_time) on every
// open session whose org-local day has ended — unlike close-stale-check-ins (03:00), which
// only flags the record and leaves the session open as a secondary backstop.
// NOTE: the Laravel scheduler is DISABLED on dev and only runs in prod — do not rely on
// this firing in tests; test autoCheckOutOpenSessions() directly.
Schedule::call(function () {
    Organization::query()
        ->select('id')
        ->chunkById(500, function ($orgs) {
            foreach ($orgs as $org) {
                ForceCheckOutOpenSessionsJob::dispatch($org->id);
            }
        });
})->dailyAt('19:00')->name('force-checkout-open-sessions');

// FIX B11: Watchdog — close stale open entries (no heartbeat for 2+ hours)
// (removed) close-stale-timer-entries — CloseStaleTimerEntriesJob duplicated
// timer:cleanup-stale below on a wider window and closed entries at `updated_at`,
// i.e. at the agent's last PUSH rather than the user's last INPUT, which bills every
// dead minute in between. One implementation now: TimeEntrySyncService::closeAbandoned-
// OpenEntries(), driven by the 5-minute command.

// Data retention enforcement — Daily 4am UTC
Schedule::job(new \App\Jobs\EnforceDataRetentionJob)->dailyAt('04:00')->name('enforce-data-retention');

// Scheduler heartbeat — proves the scheduler process is alive.
// The /jobs/health endpoint checks this marker to report scheduler status.
Schedule::call(function () {
    Cache::put('scheduler:last_run', now()->toIso8601String(), 300); // 5 min TTL
})->everyMinute()->name('scheduler-heartbeat');

// JOB-10: Weekly report emails — runs daily at 08:00 UTC, job filters by day_of_week match
Schedule::job(new \App\Jobs\SendWeeklyReportJob)->dailyAt('08:00')->withoutOverlapping()->name('weekly-report-emails');

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
