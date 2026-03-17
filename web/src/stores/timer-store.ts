import { create } from 'zustand';
import api from '@/lib/api';

interface TimerState {
  isRunning: boolean;
  entryId: string | null;
  projectId: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
  todayTotalBase: number; // Completed entries today (excludes current running)
  intervalId: ReturnType<typeof setInterval> | null;
  pollId: ReturnType<typeof setInterval> | null;

  startTimer: (projectId?: string, taskId?: string) => Promise<void>;
  stopTimer: () => Promise<Record<string, unknown> | null>;
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
  startedAt: null,
  elapsedSeconds: 0,
  todayTotalBase: 0,
  intervalId: null,
  pollId: null,

  startTimer: async (projectId?: string, taskId?: string) => {
    try {
      const res = await api.post('/timer/start', { project_id: projectId, task_id: taskId });
      // Use today_total from server (completed entries) as the base
      // This ensures we always have the correct accumulated time even after page refresh
      const serverBase = res.data.today_total || 0;
      const base = serverBase > 0 ? serverBase : get().todayTotalBase;
      set({
        isRunning: true,
        entryId: res.data.entry.id,
        projectId: res.data.entry.project_id,
        startedAt: res.data.entry.started_at,
        elapsedSeconds: base,
        todayTotalBase: base,
      });
      get().startTicking();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // 409 = timer already running on server (e.g. started from desktop app)
      if (status === 409) {
        await get().fetchStatus();
        return;
      }
      throw err;
    }
  },

  stopTimer: async () => {
    // Capture current displayed total before stopping (local fallback)
    const localTotal = get().elapsedSeconds;
    try {
      const res = await api.post('/timer/stop');
      get().stopTicking();
      // Use server today_total if > 0, otherwise keep the locally computed total
      const todayTotal = (res.data.today_total > 0) ? res.data.today_total : localTotal;
      set({
        isRunning: false,
        entryId: null,
        projectId: null,
        startedAt: null,
        elapsedSeconds: todayTotal,
        todayTotalBase: todayTotal,
      });
      return res.data.entry;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const currentElapsed = get().elapsedSeconds;
      if (status === 404) {
        get().stopTicking();
        set({
          isRunning: false,
          entryId: null,
          projectId: null,
          startedAt: null,
          elapsedSeconds: currentElapsed,
          todayTotalBase: currentElapsed,
        });
        return null;
      }
      get().stopTicking();
      set({
        isRunning: false,
        entryId: null,
        projectId: null,
        startedAt: null,
        elapsedSeconds: currentElapsed,
        todayTotalBase: currentElapsed,
      });
      throw err;
    }
  },

  fetchStatus: async () => {
    try {
      const res = await api.get('/timer/status');
      const wasRunning = get().isRunning;
      const todayTotal = res.data.today_total || 0;

      if (res.data.running) {
        const currentElapsed = res.data.elapsed_seconds || 0;
        // todayTotal includes current elapsed; base = completed only
        const base = Math.max(0, todayTotal - currentElapsed);
        set({
          isRunning: true,
          entryId: res.data.entry?.id,
          projectId: res.data.entry?.project_id,
          startedAt: res.data.entry?.started_at,
          elapsedSeconds: todayTotal, // Show full today's total
          todayTotalBase: base,
        });
        // Only start ticking if we weren't already running
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
          startedAt: null,
          elapsedSeconds: todayTotal, // Show today's total when stopped
          todayTotalBase: todayTotal,
        });
      }
    } catch {
      // Silently fail — don't break the UI on network errors
    }
  },

  startPolling: () => {
    get().stopPolling(); // Clear any existing poll
    // Poll server every 10 seconds to detect changes from desktop app
    const id = setInterval(() => get().fetchStatus(), 10000);
    set({ pollId: id });
  },

  stopPolling: () => {
    const id = get().pollId;
    if (id) clearInterval(id);
    set({ pollId: null });
  },

  tick: () => {
    const { startedAt, todayTotalBase } = get();
    if (startedAt) {
      const currentElapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      set({ elapsedSeconds: todayTotalBase + currentElapsed });
    } else {
      set((state) => ({ elapsedSeconds: state.elapsedSeconds + 1 }));
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
    const base = get().todayTotalBase;
    set({
      isRunning: false,
      entryId: null,
      projectId: null,
      startedAt: null,
      elapsedSeconds: base, // Keep today's total visible
    });
  },
}));
