import { create } from 'zustand';
import api from '@/lib/api';
import { getEcho } from '@/lib/echo';
import { useAuthStore } from '@/stores/auth-store';

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
  /** Today's cumulative total across ALL projects (all completed entries + current session). Used by dashboard "Today's Hours" card. */
  todayTotalSeconds: number;
  /** Base today total from completed entries (excludes current session). Used for tick calculation. */
  todayTotalBase: number;
  /** Today's cumulative total for the ACTIVE PROJECT only (completed entries for that project + current session). Used by header timer. */
  projectTodayTotalSeconds: number;
  /** Base project today total from completed entries for active project (excludes current session). Used for tick calculation. */
  projectTodayTotalBase: number;
  intervalId: ReturnType<typeof setInterval> | null;
  pollId: ReturnType<typeof setInterval> | null;
  /** The org ID currently subscribed to via WebSocket (used for cleanup). */
  echoOrgId: string | null;

  fetchStatus: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  setupWebSocket: () => void;
  teardownWebSocket: () => void;
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
  projectTodayTotalSeconds: 0,
  projectTodayTotalBase: 0,
  intervalId: null,
  pollId: null,
  echoOrgId: null,

  fetchStatus: async () => {
    try {
      const res = await api.get('/timer/status');
      const wasRunning = get().isRunning;
      const todayTotal = res.data.today_total || 0;
      const projectTodayTotal = res.data.project_today_total || 0;

      if (res.data.running) {
        const currentElapsed = res.data.elapsed_seconds || 0;
        const runningProjectId = res.data.entry?.project_id ?? null;
        const runningProjectName = res.data.entry?.project?.name ?? null;
        // Base = total minus the current running entry's elapsed (same logic as desktop)
        const base = Math.max(0, todayTotal - currentElapsed);
        const projectBase = Math.max(0, projectTodayTotal - currentElapsed);

        set({
          isRunning: true,
          entryId: res.data.entry?.id,
          projectId: runningProjectId,
          projectName: runningProjectName,
          startedAt: res.data.entry?.started_at,
          elapsedSeconds: currentElapsed,
          todayTotalSeconds: todayTotal,
          todayTotalBase: base,
          projectTodayTotalSeconds: projectTodayTotal,
          projectTodayTotalBase: projectBase,
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
          projectTodayTotalSeconds: 0,
          projectTodayTotalBase: 0,
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

    // Also subscribe to real-time WebSocket events for instant updates
    get().setupWebSocket();
  },

  stopPolling: () => {
    const id = get().pollId;
    if (id) {
      clearInterval(id);
      set({ pollId: null });
    }
    get().teardownWebSocket();
  },

  setupWebSocket: () => {
    if (typeof window === 'undefined') return;
    // Don't subscribe twice
    if (get().echoOrgId) return;

    try {
      const echo = getEcho();
      if (!echo) return;

      const orgId = useAuthStore.getState().user?.organization_id;
      if (!orgId) return;

      echo.private(`org.${orgId}`)
        .listen('TimerStarted', () => {
          // Immediately fetch fresh status instead of waiting for next poll
          get().fetchStatus();
        })
        .listen('TimerStopped', () => {
          get().fetchStatus();
        });

      set({ echoOrgId: orgId });
    } catch {
      // WebSocket connection failures should not break the UI — polling is the fallback
    }
  },

  teardownWebSocket: () => {
    const orgId = get().echoOrgId;
    if (!orgId) return;

    try {
      const echo = getEcho();
      if (echo) {
        echo.leave(`org.${orgId}`);
      }
    } catch {
      // Ignore cleanup errors
    }
    set({ echoOrgId: null });
  },

  tick: () => {
    const { startedAt, todayTotalBase, projectTodayTotalBase } = get();
    if (startedAt) {
      const currentElapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      set({
        elapsedSeconds: currentElapsed,
        todayTotalSeconds: todayTotalBase + currentElapsed,
        projectTodayTotalSeconds: projectTodayTotalBase + currentElapsed,
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
    // Clean up all intervals and WebSocket on reset (e.g. logout) to prevent leaked timers
    get().teardownWebSocket();
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
      projectTodayTotalSeconds: 0,
      projectTodayTotalBase: 0,
      echoOrgId: null,
    });
  },
}));
