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
  /** Handler reference for visibilitychange cleanup. */
  _visibilityHandler: (() => void) | null;
  /** BroadcastChannel for multi-tab sync. */
  _broadcastChannel: BroadcastChannel | null;

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
  _visibilityHandler: null,
  _broadcastChannel: null,

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

        const newState = {
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
        };

        set(newState);

        // Broadcast state to other tabs
        get()._broadcastChannel?.postMessage({
          type: 'timer-update',
          state: newState,
        });

        if (!wasRunning || !get().intervalId) {
          get().startTicking();
        }
      } else {
        if (wasRunning) {
          get().stopTicking();
        }

        const newState = {
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
        };

        set(newState);

        // Broadcast state to other tabs
        get()._broadcastChannel?.postMessage({
          type: 'timer-update',
          state: newState,
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

    // Set up BroadcastChannel for multi-tab sync
    if (typeof window !== 'undefined' && !get()._broadcastChannel) {
      try {
        const channel = new BroadcastChannel('trackflow-timer');
        channel.onmessage = (event: MessageEvent) => {
          if (event.data?.type === 'timer-update' && event.data.state) {
            const state = event.data.state;
            const wasRunning = get().isRunning;

            set({
              isRunning: state.isRunning,
              entryId: state.entryId,
              projectId: state.projectId,
              projectName: state.projectName,
              startedAt: state.startedAt,
              elapsedSeconds: state.elapsedSeconds,
              todayTotalSeconds: state.todayTotalSeconds,
              todayTotalBase: state.todayTotalBase,
              projectTodayTotalSeconds: state.projectTodayTotalSeconds,
              projectTodayTotalBase: state.projectTodayTotalBase,
            });

            // Start/stop ticking based on the received state
            if (state.isRunning && (!wasRunning || !get().intervalId)) {
              get().startTicking();
            } else if (!state.isRunning && wasRunning) {
              get().stopTicking();
            }
          }
        };
        set({ _broadcastChannel: channel });
      } catch {
        // BroadcastChannel not supported — fall back to independent polling
      }
    }
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

    // Item 4: Fix background tab throttling — when the user switches back
    // to this tab, immediately correct the displayed time and re-sync
    // from the server. setInterval gets throttled to ~1/min in background
    // tabs, but visibilitychange fires immediately on tab focus.
    if (typeof document !== 'undefined') {
      // Clean up any previous listener
      const prevHandler = get()._visibilityHandler;
      if (prevHandler) {
        document.removeEventListener('visibilitychange', prevHandler);
      }

      const handler = () => {
        if (document.visibilityState === 'visible') {
          get().tick();        // Immediately correct the displayed time
          get().fetchStatus(); // Also refresh from server
        }
      };
      document.addEventListener('visibilitychange', handler);
      set({ _visibilityHandler: handler });
    }
  },

  stopTicking: () => {
    const id = get().intervalId;
    if (id) clearInterval(id);
    set({ intervalId: null });

    // Clean up visibilitychange listener
    if (typeof document !== 'undefined') {
      const handler = get()._visibilityHandler;
      if (handler) {
        document.removeEventListener('visibilitychange', handler);
        set({ _visibilityHandler: null });
      }
    }
  },

  resetState: () => {
    // Clean up all intervals, WebSocket, BroadcastChannel on reset (e.g. logout)
    get().teardownWebSocket();
    get().stopPolling();
    get().stopTicking();

    // Close BroadcastChannel
    const channel = get()._broadcastChannel;
    if (channel) {
      try { channel.close(); } catch { /* ignore */ }
    }

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
      _visibilityHandler: null,
      _broadcastChannel: null,
    });
  },
}));
