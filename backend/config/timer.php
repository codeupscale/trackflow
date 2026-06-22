<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Offline Grace Window (minutes)
    |--------------------------------------------------------------------------
    |
    | How long a running time entry may go without a SERVER-received heartbeat
    | before automated cleanup is allowed to force-close it.
    |
    | Desktop agents queue heartbeats while offline and flush them on reconnect,
    | so a 30-minute threshold would truncate legitimate offline work. This grace
    | window must cover the longest expected offline-tracking stretch (~3-4 hours)
    | so that flushed heartbeats land before the entry is auto-closed.
    |
    | Used by:
    |   - App\Console\Commands\CleanupStaleEntries (primary cleanup threshold)
    |   - App\Jobs\CloseStaleTimerEntriesJob       (longer backstop, >= this value)
    |
    */

    'offline_grace_minutes' => (int) env('TIMER_OFFLINE_GRACE_MINUTES', 240), // 4 hours

];
