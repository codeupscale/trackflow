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
    elapsedSeconds,
    projectName,
    fetchStatus,
    startPolling,
    stopPolling,
  } = useTimerStore();

  // Fetch status on mount and poll for updates from the desktop agent
  useEffect(() => {
    fetchStatus().catch(() => {});
    startPolling();
    return () => stopPolling();
  }, [fetchStatus, startPolling, stopPolling]);

  return (
    <div className="flex items-center gap-2.5">
      {/* Status indicator */}
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors',
          isRunning
            ? 'bg-green-950/40 border border-green-800/50'
            : 'bg-slate-800/50 border border-slate-700/50'
        )}
      >
        {/* Icon */}
        {isRunning ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <Monitor className="h-3.5 w-3.5 text-green-400" />
          </div>
        ) : (
          <MonitorOff className="h-3.5 w-3.5 text-slate-500" />
        )}

        {/* Project name when tracking */}
        {isRunning && projectName && (
          <span className="text-xs text-green-300/80 font-medium truncate max-w-[140px]">
            {projectName}
          </span>
        )}

        {/* Timer display */}
        <span
          className={cn(
            'font-mono text-sm font-medium tabular-nums',
            isRunning ? 'text-green-400' : 'text-slate-500'
          )}
        >
          {isRunning ? formatDuration(elapsedSeconds) : 'Not tracking'}
        </span>
      </div>
    </div>
  );
}
