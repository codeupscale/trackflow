<?php

use App\Jobs\PruneOldActivityLogsJob;
use App\Jobs\SendTimerIdleAlertJob;
use App\Jobs\SendTimesheetReminderJob;
use App\Models\Organization;
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

// Data retention enforcement — Daily 4am UTC
Schedule::job(new \App\Jobs\EnforceDataRetentionJob)->dailyAt('04:00')->name('enforce-data-retention');
