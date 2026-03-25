import { create } from 'zustand';
import api from '@/lib/api';

/**
 * Read-only timer status store for the web dashboard.
 *
 * The web portal does NOT start or stop timers. Timer lifecycle is managed
 * exclusively by the desktop agent (which captures screenshots, monitors
 * activity, and detects idle time). This store only polls the backend
 * for the current status and keeps the UI ticking when a timer is active.
 */

interface TimerState {
  isRunning: boolean;
  entryId: string | null;
  projectId: string | null;
  projectName: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
  /** Today's cumulative total (all completed entries + current session). Mirrors desktop "Today's Total". */
  todayTotalSeconds: number;
  /** Base today total from completed entries (excludes current session). Used for tick calculation. */
  todayTotalBase: number;
  intervalId: ReturnType<typeof setInterval> | null;
  pollId: ReturnType<typeof setInterval> | null;

  fetchStatus: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  tick: () => void;
  startTicking: () => void;
  stopTicking: () => void;
  resetState: () => void;
}

export const useTimerStore = create<TimerState>()((set, get) => ({
  isRunning: false,
  entryId: null,
  projectId: null,
  projectName: null,
  startedAt: null,
  elapsedSeconds: 0,
  todayTotalSeconds: 0,
  todayTotalBase: 0,
  intervalId: null,
  pollId: null,

  fetchStatus: async () => {
    try {
      const res = await api.get('/timer/status');
      const wasRunning = get().isRunning;
      const todayTotal = res.data.today_total || 0;

      if (res.data.running) {
        const currentElapsed = res.data.elapsed_seconds || 0;
        const runningProjectId = res.data.entry?.project_id ?? null;
        const runningProjectName = res.data.entry?.project?.name ?? null;
        // Base = today_total minus the current running entry's elapsed (same logic as desktop)
        const base = Math.max(0, todayTotal - currentElapsed);

        set({
          isRunning: true,
          entryId: res.data.entry?.id,
          projectId: runningProjectId,
          projectName: runningProjectName,
          startedAt: res.data.entry?.started_at,
          elapsedSeconds: currentElapsed,
          todayTotalSeconds: todayTotal,
          todayTotalBase: base,
        });
        if (!wasRunning || !get().intervalId) {
          get().startTicking();
        }
      } else {
        if (wasRunning) {
          get().stopTicking();
        }
        set({
          isRunning: false,
          entryId: null,
          projectId: null,
          projectName: null,
          startedAt: null,
          elapsedSeconds: 0,
          todayTotalSeconds: todayTotal,
          todayTotalBase: todayTotal,
        });
      }
    } catch {
      // Silently fail — don't break the UI on network errors
    }
  },

  startPolling: () => {
    // Mutex: if a poll interval already exists, don't create another
    if (get().pollId) return;
    const id = setInterval(() => get().fetchStatus(), 10000);
    set({ pollId: id });
  },

  stopPolling: () => {
    const id = get().pollId;
    if (id) {
      clearInterval(id);
      set({ pollId: null });
    }
  },

  tick: () => {
    const { startedAt, todayTotalBase } = get();
    if (startedAt) {
      const currentElapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      set({
        elapsedSeconds: currentElapsed,
        todayTotalSeconds: todayTotalBase + currentElapsed,
      });
    }
  },

  startTicking: () => {
    const existing = get().intervalId;
    if (existing) clearInterval(existing);
    const id = setInterval(() => get().tick(), 1000);
    set({ intervalId: id });
  },

  stopTicking: () => {
    const id = get().intervalId;
    if (id) clearInterval(id);
    set({ intervalId: null });
  },

  resetState: () => {
    // Clean up all intervals on reset (e.g. logout) to prevent leaked timers
    get().stopPolling();
    get().stopTicking();
    set({
      isRunning: false,
      entryId: null,
      projectId: null,
      projectName: null,
      startedAt: null,
      elapsedSeconds: 0,
      todayTotalSeconds: 0,
      todayTotalBase: 0,
    });
  },
}));
