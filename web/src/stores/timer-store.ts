import { create } from 'zustand';
import api from '@/lib/api';

interface TimerState {
  isRunning: boolean;
  entryId: string | null;
  projectId: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
  intervalId: ReturnType<typeof setInterval> | null;

  startTimer: (projectId?: string, taskId?: string) => Promise<void>;
  stopTimer: () => Promise<Record<string, unknown>>;
  fetchStatus: () => Promise<void>;
  tick: () => void;
  startTicking: () => void;
  stopTicking: () => void;
}

export const useTimerStore = create<TimerState>()((set, get) => ({
  isRunning: false,
  entryId: null,
  projectId: null,
  startedAt: null,
  elapsedSeconds: 0,
  intervalId: null,

  startTimer: async (projectId?: string, taskId?: string) => {
    const res = await api.post('/timer/start', { project_id: projectId, task_id: taskId });
    set({
      isRunning: true,
      entryId: res.data.entry.id,
      projectId: res.data.entry.project_id,
      startedAt: res.data.entry.started_at,
      elapsedSeconds: 0,
    });
    get().startTicking();
  },

  stopTimer: async () => {
    const res = await api.post('/timer/stop');
    get().stopTicking();
    set({
      isRunning: false,
      entryId: null,
      projectId: null,
      startedAt: null,
      elapsedSeconds: 0,
    });
    return res.data.entry;
  },

  fetchStatus: async () => {
    const res = await api.get('/timer/status');
    if (res.data.running) {
      set({
        isRunning: true,
        entryId: res.data.entry?.id,
        projectId: res.data.entry?.project_id,
        startedAt: res.data.entry?.started_at,
        elapsedSeconds: res.data.elapsed_seconds,
      });
      get().startTicking();
    } else {
      get().stopTicking();
      set({ isRunning: false, entryId: null, projectId: null, startedAt: null, elapsedSeconds: 0 });
    }
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
}));
