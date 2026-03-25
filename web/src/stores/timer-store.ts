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

  setSelectedProjectId: (projectId) => {
    set({ selectedProjectId: projectId });
    // Persist to localStorage so it survives logout/login cycles
    if (typeof window !== 'undefined') {
      if (projectId) {
        localStorage.setItem('trackflow_selected_project_id', projectId);
      } else {
        localStorage.removeItem('trackflow_selected_project_id');
      }
    }
  },

  startTimer: async (projectId?: string, taskId?: string) => {
    try {
      const res = await api.post('/timer/start', { project_id: projectId, task_id: taskId });
      const serverTodayTotal = res.data.today_total || 0;
      const startedAt = res.data.entry?.started_at;
      const currentElapsed = startedAt
        ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
        : 0;
      const completedOnlyBase = Math.max(0, serverTodayTotal - currentElapsed);
      set({
        isRunning: true,
        entryId: res.data.entry.id,
        projectId: res.data.entry.project_id,
        startedAt: res.data.entry.started_at,
        elapsedSeconds: serverTodayTotal,
        todayTotalBase: completedOnlyBase,
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
        const runningProjectId = res.data.entry?.project_id ?? null;

        // When the timer runs on a different project than the selected one,
        // today_total won't include the running entry's elapsed time.
        // Detect this mismatch and compute display values correctly.
        const timerMatchesScope =
          scopeProjectId === null ||
          scopeProjectId === runningProjectId;

        // If the running project matches the scope, today_total already
        // includes currentElapsed, so base = todayTotal - currentElapsed.
        // If they don't match, the running timer's elapsed isn't in
        // todayTotal, so we add it for display and base stays todayTotal.
        const displayTotal = timerMatchesScope
          ? todayTotal
          : todayTotal + currentElapsed;
        const base = timerMatchesScope
          ? Math.max(0, todayTotal - currentElapsed)
          : todayTotal;

        set({
          isRunning: true,
          entryId: res.data.entry?.id,
          projectId: runningProjectId,
          startedAt: res.data.entry?.started_at,
          elapsedSeconds: displayTotal,
          todayTotalBase: base,
          // Keep dropdown in sync when timer was started elsewhere (e.g. desktop)
          selectedProjectId: get().selectedProjectId ?? runningProjectId,
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
    // Mutex: if a poll interval already exists, don't create another
    if (get().pollId) return;
    const id = setInterval(() => get().fetchStatus(get().selectedProjectId), 10000);
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
    // Always tick when a timer is running — the header should show the
    // running total even if the selected project differs from the running one.
    // todayTotalBase already accounts for project-scope mismatch (see fetchStatus).
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
    // Clean up all intervals on reset (e.g. logout) to prevent leaked timers
    get().stopPolling();
    get().stopTicking();
    set({
      isRunning: false,
      entryId: null,
      projectId: null,
      startedAt: null,
      elapsedSeconds: 0,
      todayTotalBase: 0,
      selectedProjectId: null,
    });
  },
}));
