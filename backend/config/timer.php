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

    /*
    |--------------------------------------------------------------------------
    | Maximum Entry Duration (seconds)
    |--------------------------------------------------------------------------
    |
    | Hard ceiling on any single time entry, so a runaway timer cannot corrupt
    | reports. Raised from 12h to 24h alongside the offline-first refactor.
    |
    | The desktop agent SPLITS the live session at midnight in the organization's
    | timezone, so a legitimate entry can never span two calendar days and this
    | ceiling is not reachable in normal operation — it is a backstop for a
    | corrupt clock or a hand-crafted payload, not a routine clamp.
    |
    | Used by: App\Services\TimeEntrySyncService, App\Console\Commands\CleanupStaleEntries
    |
    */

    'max_entry_duration' => (int) env('TIMER_MAX_ENTRY_DURATION', 86400), // 24 hours

    /*
    |--------------------------------------------------------------------------
    | Maximum Backfill Age (seconds)
    |--------------------------------------------------------------------------
    |
    | How far in the past a client-supplied timestamp may be and still be accepted.
    |
    | This was 24h, which silently made the product's core promise unkeepable: a
    | laptop that tracked offline over a long weekend had every session REJECTED
    | on reconnect, because the whole batch predated the window. Since local SQLite
    | is now the source of truth and the agent retries until the server confirms,
    | this must cover the longest realistic offline stretch. 30 days.
    |
    | Keep in step with ScreenshotController::OFFLINE_BACKFILL_DAYS — a session that
    | uploads but whose screenshots are refused is its own data-loss bug.
    |
    | Used by: App\Services\TimeEntrySyncService::parseClientTimestamp()
    |
    */

    'max_past_skew' => (int) env('TIMER_MAX_PAST_SKEW', 2592000), // 30 days

    /*
    |--------------------------------------------------------------------------
    | Maximum Future Skew (seconds)
    |--------------------------------------------------------------------------
    |
    | Tolerance for a client clock running ahead of the server. Values inside the
    | window are clamped back to now(); anything beyond it is rejected, so stored
    | data never claims a future start.
    |
    */

    'max_future_skew' => (int) env('TIMER_MAX_FUTURE_SKEW', 300), // 5 minutes

    /*
    |--------------------------------------------------------------------------
    | Session Sync Batch Cap
    |--------------------------------------------------------------------------
    |
    | Maximum number of sessions accepted in one POST /timer/sessions/sync call.
    | The agent pages through larger backlogs; this bounds per-request work so a
    | month-long offline backlog cannot produce a single enormous transaction.
    |
    */

    'sync_batch_max' => (int) env('TIMER_SYNC_BATCH_MAX', 100),

];
