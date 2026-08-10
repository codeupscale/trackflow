'use client';

import { useEffect } from 'react';
import { Monitor, MonitorOff } from 'lucide-react';

import { useTimerStore } from '@/stores/timer-store';
import { formatDuration, cn } from '@/lib/utils';

/**
 * Read-only timer status widget for the dashboard header.
 *
 * Displays the current tracking state driven by the desktop agent.
 * The web portal does NOT start or stop timers — that is exclusively
 * the desktop agent's responsibility (it captures screenshots, monitors
 * activity levels, and manages the timer lifecycle).
 */
export function TimerWidget() {
  const {
    isRunning,
    isPaused,
    projectTodayTotalSeconds,
    todayTotalSeconds,
    projectName,
    liveAsOf,
    elapsedIsStale,
    fetchStatus,
    startPolling,
    stopPolling,
  } = useTimerStore();

  // The agent has gone quiet, so the counter is frozen at the last instant the server
  // can vouch for. Say so rather than presenting a stopped clock as a live one — a
  // silently frozen timer reads exactly like a running one that is simply between ticks.
  const staleLabel =
    elapsedIsStale && liveAsOf
      ? new Date(liveAsOf).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  // Fetch status on mount and poll for updates from the desktop agent
  useEffect(() => {
    fetchStatus().catch(() => {});
    startPolling();
    return () => stopPolling();
  }, [fetchStatus, startPolling, stopPolling]);

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors',
          isRunning
            ? 'bg-emerald-500/10 border border-emerald-500/20'
            : isPaused
              ? 'bg-amber-500/10 border border-amber-500/20'
              : 'bg-muted/50 border border-border'
        )}
      >
        {isRunning ? (
          <div className="flex items-center gap-2">
            {/* No ping animation while frozen — a pulsing dot is the one cue that
                says "this number is moving", and it is not. */}
            <span className="relative flex h-2 w-2">
              {!staleLabel && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              )}
              <span
                className={cn(
                  'relative inline-flex rounded-full h-2 w-2',
                  staleLabel ? 'bg-muted-foreground' : 'bg-green-500'
                )}
              />
            </span>
            <Monitor
              className={cn(
                'h-3.5 w-3.5',
                staleLabel ? 'text-muted-foreground' : 'text-green-400'
              )}
            />
          </div>
        ) : isPaused ? (
          <div className="flex items-center gap-2">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            <Monitor className="h-3.5 w-3.5 text-amber-500" />
          </div>
        ) : (
          <MonitorOff className="h-3.5 w-3.5 text-muted-foreground" />
        )}

        {(isRunning || isPaused) && projectName && (
          <span
            className={cn(
              'text-xs font-medium truncate max-w-[140px]',
              isRunning
                ? 'text-emerald-600 dark:text-emerald-300/90'
                : 'text-amber-700 dark:text-amber-300/90'
            )}
          >
            {projectName}
          </span>
        )}

        <span
          className={cn(
            'font-mono text-sm font-medium tabular-nums',
            isRunning && !staleLabel
              ? 'text-emerald-600 dark:text-emerald-400'
              : isPaused
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-muted-foreground'
          )}
          title={
            staleLabel
              ? `The desktop agent last reported at ${staleLabel}. It uploads in batches, so this figure is held at its last confirmed value instead of counting on.`
              : undefined
          }
        >
          {isPaused
            ? `Paused · ${formatDuration(projectTodayTotalSeconds)}`
            : isRunning
              ? staleLabel
                ? `${formatDuration(projectTodayTotalSeconds)} · as of ${staleLabel}`
                : formatDuration(projectTodayTotalSeconds)
              : todayTotalSeconds > 0
                ? formatDuration(todayTotalSeconds)
                : 'Not tracking'}
        </span>
      </div>
    </div>
  );
}
