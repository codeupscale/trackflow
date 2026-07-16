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

    /*
    |--------------------------------------------------------------------------
    | Minimum Desktop Agent Version
    |--------------------------------------------------------------------------
    |
    | Desktop builds older than this are refused (426) on the timer routes, so
    | client-side policy — e.g. the removal of the idle "Keep"/"Reassign"
    | actions — cannot be bypassed by staying on an old build.
    |
    | EMPTY = DISABLED (default). Left off until the replacement build is
    | actually released and rolled out: setting it too early locks every desktop
    | out of tracking. Set to the first release that carries the policy, e.g.
    | TIMER_MIN_AGENT_VERSION=1.0.44
    |
    | Only affects requests sending `X-TrackFlow-Client: desktop`; the web
    | dashboard is never gated.
    |
    | Used by: App\Http\Middleware\EnforceMinimumAgentVersion
    |
    */

    'min_agent_version' => env('TIMER_MIN_AGENT_VERSION', ''),

];
