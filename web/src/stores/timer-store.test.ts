import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimerStore } from '@/stores/timer-store';

// ─── Mocks ────────────────────────────────────────────────────────

const mockApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

vi.mock('@/lib/echo', () => ({
  getEcho: () => null,
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: { organization_id: 'org-1' } }),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────

function resetStore() {
  const store = useTimerStore.getState();
  // Clear any intervals before resetting
  if (store.intervalId) clearInterval(store.intervalId);
  if (store.pollId) clearInterval(store.pollId);
  useTimerStore.setState({
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
  });
}

// ─── Tests ────────────────────────────────────────────────────────

describe('TimerStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    resetStore();
    vi.useRealTimers();
  });

  // ── fetchStatus ─────────────────────────────────────────────────

  describe('fetchStatus', () => {
    it('sets running state when timer is active', async () => {
      const now = new Date('2026-03-27T10:00:00Z');
      vi.setSystemTime(now);

      mockApiGet.mockResolvedValueOnce({
        data: {
          running: true,
          entry: {
            id: 'entry-1',
            project_id: 'proj-1',
            project: { name: 'TrackFlow' },
            started_at: '2026-03-27T09:00:00Z',
          },
          elapsed_seconds: 3600,
          today_total: 7200,
          project_today_total: 3600,
        },
      });

      await useTimerStore.getState().fetchStatus();

      const state = useTimerStore.getState();
      expect(state.isRunning).toBe(true);
      expect(state.entryId).toBe('entry-1');
      expect(state.projectId).toBe('proj-1');
      expect(state.projectName).toBe('TrackFlow');
      expect(state.elapsedSeconds).toBe(3600);
      expect(state.todayTotalSeconds).toBe(7200);
    });

    it('sets stopped state when timer is not active', async () => {
      mockApiGet.mockResolvedValueOnce({
        data: {
          running: false,
          entry: null,
          elapsed_seconds: 0,
          today_total: 5400,
          project_today_total: 0,
        },
      });

      await useTimerStore.getState().fetchStatus();

      const state = useTimerStore.getState();
      expect(state.isRunning).toBe(false);
      expect(state.entryId).toBeNull();
      expect(state.elapsedSeconds).toBe(0);
      expect(state.todayTotalSeconds).toBe(5400);
    });

    it('reads today_total from API response', async () => {
      mockApiGet.mockResolvedValueOnce({
        data: {
          running: false,
          entry: null,
          elapsed_seconds: 0,
          today_total: 14400,
          project_today_total: 0,
        },
      });

      await useTimerStore.getState().fetchStatus();

      expect(useTimerStore.getState().todayTotalSeconds).toBe(14400);
    });

    it('computes todayTotalBase by subtracting current elapsed', async () => {
      mockApiGet.mockResolvedValueOnce({
        data: {
          running: true,
          entry: {
            id: 'entry-1',
            project_id: null,
            started_at: '2026-03-27T09:30:00Z',
          },
          elapsed_seconds: 1800,
          today_total: 5400,
          project_today_total: 1800,
        },
      });

      await useTimerStore.getState().fetchStatus();

      const state = useTimerStore.getState();
      // base = 5400 - 1800 = 3600
      expect(state.todayTotalBase).toBe(3600);
    });

    it('handles API failure gracefully without crashing', async () => {
      mockApiGet.mockRejectedValueOnce(new Error('Network Error'));

      // Should not throw
      await useTimerStore.getState().fetchStatus();

      // State should remain unchanged (default values)
      const state = useTimerStore.getState();
      expect(state.isRunning).toBe(false);
    });

    it('timer resets to 0 after stop', async () => {
      // First: timer running
      mockApiGet.mockResolvedValueOnce({
        data: {
          running: true,
          entry: {
            id: 'entry-1',
            project_id: null,
            started_at: '2026-03-27T09:00:00Z',
          },
          elapsed_seconds: 3600,
          today_total: 3600,
          project_today_total: 3600,
        },
      });
      await useTimerStore.getState().fetchStatus();
      expect(useTimerStore.getState().isRunning).toBe(true);

      // Then: timer stopped
      mockApiGet.mockResolvedValueOnce({
        data: {
          running: false,
          entry: null,
          elapsed_seconds: 0,
          today_total: 3600,
          project_today_total: 0,
        },
      });
      await useTimerStore.getState().fetchStatus();

      const state = useTimerStore.getState();
      expect(state.isRunning).toBe(false);
      expect(state.elapsedSeconds).toBe(0);
      expect(state.entryId).toBeNull();
    });
  });

  // ── tick ─────────────────────────────────────────────────────────

  describe('tick', () => {
    it('updates elapsed every second based on startedAt', () => {
      const startedAt = new Date('2026-03-27T09:00:00Z');
      vi.setSystemTime(new Date('2026-03-27T09:05:00Z'));

      useTimerStore.setState({
        isRunning: true,
        startedAt: startedAt.toISOString(),
        todayTotalBase: 1000,
        projectTodayTotalBase: 500,
      });

      useTimerStore.getState().tick();

      const state = useTimerStore.getState();
      // 5 minutes = 300 seconds
      expect(state.elapsedSeconds).toBe(300);
      expect(state.todayTotalSeconds).toBe(1300); // 1000 + 300
      expect(state.projectTodayTotalSeconds).toBe(800); // 500 + 300
    });

    it('does nothing when startedAt is null', () => {
      useTimerStore.setState({
        isRunning: false,
        startedAt: null,
        elapsedSeconds: 0,
        todayTotalSeconds: 100,
      });

      useTimerStore.getState().tick();

      expect(useTimerStore.getState().elapsedSeconds).toBe(0);
      expect(useTimerStore.getState().todayTotalSeconds).toBe(100);
    });

    it('todayTotalSeconds accumulates correctly across sessions', () => {
      vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));

      // Base from completed entries = 7200 (2 hours)
      // Current session started 30 min ago
      useTimerStore.setState({
        isRunning: true,
        startedAt: '2026-03-27T09:30:00Z',
        todayTotalBase: 7200,
        projectTodayTotalBase: 3600,
      });

      useTimerStore.getState().tick();

      const state = useTimerStore.getState();
      // elapsed = 1800 (30 min)
      expect(state.elapsedSeconds).toBe(1800);
      // total = 7200 + 1800 = 9000
      expect(state.todayTotalSeconds).toBe(9000);
    });
  });

  // ── startTicking / stopTicking ──────────────────────────────────

  describe('startTicking / stopTicking', () => {
    it('startTicking creates interval that calls tick', () => {
      vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));

      useTimerStore.setState({
        isRunning: true,
        startedAt: '2026-03-27T09:59:59Z',
        todayTotalBase: 0,
        projectTodayTotalBase: 0,
      });

      useTimerStore.getState().startTicking();
      expect(useTimerStore.getState().intervalId).not.toBeNull();

      // After 1 second, tick should fire
      vi.advanceTimersByTime(1000);
      expect(useTimerStore.getState().elapsedSeconds).toBeGreaterThanOrEqual(1);
    });

    it('stopTicking clears interval', () => {
      useTimerStore.getState().startTicking();
      expect(useTimerStore.getState().intervalId).not.toBeNull();

      useTimerStore.getState().stopTicking();
      expect(useTimerStore.getState().intervalId).toBeNull();
    });

    it('startTicking replaces existing interval (no double-tick)', () => {
      useTimerStore.getState().startTicking();
      const firstId = useTimerStore.getState().intervalId;

      useTimerStore.getState().startTicking();
      const secondId = useTimerStore.getState().intervalId;

      // Should have replaced, not duplicated
      expect(secondId).not.toBe(firstId);
    });
  });

  // ── startPolling / stopPolling ──────────────────────────────────

  describe('startPolling / stopPolling', () => {
    it('startPolling creates poll interval', () => {
      useTimerStore.getState().startPolling();
      expect(useTimerStore.getState().pollId).not.toBeNull();
    });

    it('startPolling does not double-start (mutex)', () => {
      useTimerStore.getState().startPolling();
      const firstId = useTimerStore.getState().pollId;

      useTimerStore.getState().startPolling();
      const secondId = useTimerStore.getState().pollId;

      expect(secondId).toBe(firstId); // Same interval, not duplicated
    });

    it('stopPolling clears poll interval', () => {
      useTimerStore.getState().startPolling();
      expect(useTimerStore.getState().pollId).not.toBeNull();

      useTimerStore.getState().stopPolling();
      expect(useTimerStore.getState().pollId).toBeNull();
    });
  });

  // ── resetState ──────────────────────────────────────────────────

  describe('resetState', () => {
    it('clears all state on logout', () => {
      useTimerStore.setState({
        isRunning: true,
        entryId: 'entry-1',
        projectId: 'proj-1',
        projectName: 'Test',
        startedAt: '2026-03-27T09:00:00Z',
        elapsedSeconds: 3600,
        todayTotalSeconds: 7200,
        todayTotalBase: 3600,
        projectTodayTotalSeconds: 3600,
        projectTodayTotalBase: 0,
      });

      useTimerStore.getState().resetState();

      const state = useTimerStore.getState();
      expect(state.isRunning).toBe(false);
      expect(state.entryId).toBeNull();
      expect(state.projectId).toBeNull();
      expect(state.projectName).toBeNull();
      expect(state.startedAt).toBeNull();
      expect(state.elapsedSeconds).toBe(0);
      expect(state.todayTotalSeconds).toBe(0);
      expect(state.todayTotalBase).toBe(0);
      expect(state.projectTodayTotalSeconds).toBe(0);
      expect(state.projectTodayTotalBase).toBe(0);
    });
  });
});
