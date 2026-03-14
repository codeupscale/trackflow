<?php

use App\Jobs\PruneOldActivityLogsJob;
use App\Jobs\SendTimesheetReminderJob;
use App\Models\Organization;
use Illuminate\Support\Facades\Schedule;

// JOB-04: Timesheet reminders — Friday 4pm
Schedule::call(function () {
    Organization::all()->each(function ($org) {
        SendTimesheetReminderJob::dispatch(
            $org->id,
            now()->startOfWeek()->toDateString()
        );
    });
})->weeklyOn(5, '16:00')->name('timesheet-reminders');

// JOB-06: Prune old activity logs — Daily 2am UTC
Schedule::call(function () {
    Organization::all()->each(function ($org) {
        PruneOldActivityLogsJob::dispatch($org->id);
    });
})->dailyAt('02:00')->name('prune-activity-logs');
