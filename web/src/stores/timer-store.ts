import { create } from 'zustand';
import api from '@/lib/api';

interface TimerState {
  isRunning: boolean;
  entryId: string | null;
  projectId: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
  todayTotalBase: number; // Completed entries today (excludes current running)
  /** Project ID selected in header dropdown; when set, elapsedSeconds is scoped to this project */
  selectedProjectId: string | null;
  intervalId: ReturnType<typeof setInterval> | null;
  pollId: ReturnType<typeof setInterval> | null;

  startTimer: (projectId?: string, taskId?: string) => Promise<void>;
  stopTimer: () => Promise<Record<string, unknown> | null>;
  fetchStatus: (projectId?: string | null) => Promise<void>;
  setSelectedProjectId: (projectId: string | null) => void;
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
  selectedProjectId: null,
  intervalId: null,
  pollId: null,

  setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),

  startTimer: async (projectId?: string, taskId?: string) => {
    try {
      const res = await api.post('/timer/start', { project_id: projectId, task_id: taskId });
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
      // Refresh display for the project we just started (project-scoped total)
      await get().fetchStatus(projectId ?? get().selectedProjectId);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        await get().fetchStatus(get().selectedProjectId);
        return;
      }
      throw err;
    }
  },

  stopTimer: async () => {
    const localTotal = get().elapsedSeconds;
    const selectedProjectId = get().selectedProjectId;
    try {
      const res = await api.post('/timer/stop');
      get().stopTicking();
      const todayTotal = (res.data.today_total > 0) ? res.data.today_total : localTotal;
      set({
        isRunning: false,
        entryId: null,
        projectId: null,
        startedAt: null,
        elapsedSeconds: todayTotal,
        todayTotalBase: todayTotal,
      });
      // Refresh display for selected project (project-scoped total after stop)
      await get().fetchStatus(selectedProjectId);
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
        await get().fetchStatus(selectedProjectId);
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
      await get().fetchStatus(selectedProjectId);
      throw err;
    }
  },

  fetchStatus: async (projectId?: string | null) => {
    const scopeProjectId = projectId ?? get().selectedProjectId;
    try {
      const params = scopeProjectId ? { project_id: scopeProjectId } : {};
      const res = await api.get('/timer/status', { params });
      const wasRunning = get().isRunning;
      const todayTotal = res.data.today_total || 0;

      if (res.data.running) {
        const currentElapsed = res.data.elapsed_seconds || 0;
        const base = Math.max(0, todayTotal - currentElapsed);
        set({
          isRunning: true,
          entryId: res.data.entry?.id,
          projectId: res.data.entry?.project_id,
          startedAt: res.data.entry?.started_at,
          elapsedSeconds: todayTotal,
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
          startedAt: null,
          elapsedSeconds: todayTotal,
          todayTotalBase: todayTotal,
        });
      }
    } catch {
      // Silently fail — don't break the UI on network errors
    }
  },

  startPolling: () => {
    get().stopPolling();
    const id = setInterval(() => get().fetchStatus(get().selectedProjectId), 10000);
    set({ pollId: id });
  },

  stopPolling: () => {
    const id = get().pollId;
    if (id) clearInterval(id);
    set({ pollId: null });
  },

  tick: () => {
    const { startedAt, todayTotalBase, projectId, selectedProjectId } = get();
    // Only tick when showing the running project (or "all" when no project selected)
    if (selectedProjectId !== null && projectId !== selectedProjectId) return;
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
