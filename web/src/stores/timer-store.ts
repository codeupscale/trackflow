import { create } from 'zustand';
import api from '@/lib/api';

interface TimerState {
  isRunning: boolean;
  entryId: string | null;
  projectId: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
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
  intervalId: null,
  pollId: null,

  startTimer: async (projectId?: string, taskId?: string) => {
    try {
      const res = await api.post('/timer/start', { project_id: projectId, task_id: taskId });
      set({
        isRunning: true,
        entryId: res.data.entry.id,
        projectId: res.data.entry.project_id,
        startedAt: res.data.entry.started_at,
        elapsedSeconds: 0,
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
    try {
      const res = await api.post('/timer/stop');
      get().stopTicking();
      get().resetState();
      return res.data.entry;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // 404 = timer already stopped on server (e.g. stopped from desktop app)
      // Always reset local state — the timer IS stopped on the server
      if (status === 404) {
        get().stopTicking();
        get().resetState();
        return null;
      }
      // For any other error, still reset local state to avoid stuck UI
      get().stopTicking();
      get().resetState();
      throw err;
    }
  },

  fetchStatus: async () => {
    try {
      const res = await api.get('/timer/status');
      const wasRunning = get().isRunning;

      if (res.data.running) {
        set({
          isRunning: true,
          entryId: res.data.entry?.id,
          projectId: res.data.entry?.project_id,
          startedAt: res.data.entry?.started_at,
          elapsedSeconds: res.data.elapsed_seconds,
        });
        // Only start ticking if we weren't already running
        if (!wasRunning || !get().intervalId) {
          get().startTicking();
        }
      } else {
        if (wasRunning) {
          get().stopTicking();
        }
        set({ isRunning: false, entryId: null, projectId: null, startedAt: null, elapsedSeconds: 0 });
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

  tick: () => set((state) => ({ elapsedSeconds: state.elapsedSeconds + 1 })),

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
    set({
      isRunning: false,
      entryId: null,
      projectId: null,
      startedAt: null,
      elapsedSeconds: 0,
    });
  },
}));
