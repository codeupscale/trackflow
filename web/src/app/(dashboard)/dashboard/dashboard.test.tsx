import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';

// ─── Mocks ───────────────────────────────────────────────────────

// Mock api module
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

// Mock auth store
const mockUser = vi.fn();
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) =>
    selector({ user: mockUser() }),
}));

// Mock DateFilter component (avoid complex internal dependencies)
vi.mock('@/components/date-filter', () => ({
  DateFilter: ({
    filterPreset,
    rangeLabel,
  }: {
    filterPreset: string;
    dateFrom: string;
    dateTo: string;
    rangeLabel: string;
    onPreset: (preset: string) => void;
    onCustomApply: (from: string, to: string) => void;
  }) => (
    <div data-testid="date-filter">
      <span data-testid="filter-preset">{filterPreset}</span>
      <span data-testid="range-label">{rangeLabel}</span>
    </div>
  ),
}));

// ─── Helpers ─────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function renderDashboard() {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>
  );
}

// ─── Admin/Owner response data ───────────────────────────────────

const adminDashboardResponse = {
  online_users: [{ user: { id: 'user-1' } }],
  team_summary: [
    {
      user: {
        id: 'user-1',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        avatar_url: null,
      },
      today_seconds: 7200,
      activity_score: 85,
    },
    {
      user: {
        id: 'user-2',
        name: 'Bob Smith',
        email: 'bob@example.com',
        avatar_url: null,
      },
      today_seconds: 3600,
      activity_score: 45,
    },
  ],
  active_projects: 5,
};

const employeeDashboardResponse = {
  today_seconds: 3600,
  timer: null,
  week_seconds: 14400,
  weekly_hours_target: 40,
  daily_breakdown: [
    { date: '2026-03-23', day: 'Mon', seconds: 3600, hours: 1 },
    { date: '2026-03-24', day: 'Tue', seconds: 7200, hours: 2 },
    { date: '2026-03-25', day: 'Wed', seconds: 5400, hours: 1.5 },
    { date: '2026-03-26', day: 'Thu', seconds: 3600, hours: 1 },
    { date: '2026-03-27', day: 'Fri', seconds: 0, hours: 0 },
    { date: '2026-03-28', day: 'Sat', seconds: 0, hours: 0 },
    { date: '2026-03-29', day: 'Sun', seconds: 0, hours: 0 },
  ],
};

const timeEntriesResponse = {
  data: [
    {
      id: 'te-1',
      started_at: '2026-03-26T09:00:00Z',
      ended_at: '2026-03-26T10:00:00Z',
      duration_seconds: 3600,
      project: { name: 'TrackFlow', color: '#4f46e5' },
      task: { title: 'Dashboard redesign' },
    },
    {
      id: 'te-2',
      started_at: '2026-03-26T10:15:00Z',
      ended_at: null,
      duration_seconds: 0,
      project: { name: 'TrackFlow', color: '#4f46e5' },
      task: null,
    },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Admin/Owner View ──────────────────────────────────────────

  describe('admin/owner view', () => {
    beforeEach(() => {
      mockUser.mockReturnValue({
        id: 'admin-1',
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'owner',
        organization_id: 'org-1',
      });
    });

    it('renders dashboard title and subtitle', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: timeEntriesResponse });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('renders admin stat cards (Total Online, Hours, Active Projects, Team Members)', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: timeEntriesResponse });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Total Online')).toBeInTheDocument();
      });

      expect(screen.getByText('Active Projects')).toBeInTheDocument();
      expect(screen.getByText('Team Members')).toBeInTheDocument();
    });

    it('renders team activity table with member data', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: timeEntriesResponse });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
      });

      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    it('shows online/offline status badges for team members', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: timeEntriesResponse });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Online')).toBeInTheDocument();
      });

      expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('shows "No team members yet" when team is empty', async () => {
      const emptyResponse = {
        online_users: [],
        team_summary: [],
        active_projects: 0,
      };

      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: emptyResponse });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('No team members yet')).toBeInTheDocument();
      });
    });
  });

  // ── Employee View ─────────────────────────────────────────────

  describe('employee view', () => {
    beforeEach(() => {
      mockUser.mockReturnValue({
        id: 'emp-1',
        name: 'Employee User',
        email: 'employee@example.com',
        role: 'employee',
        organization_id: 'org-1',
      });
    });

    it('renders employee stat cards (Status, Hours, This Week)', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: employeeDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Status')).toBeInTheDocument();
      });

      expect(screen.getByText('This Week')).toBeInTheDocument();
    });

    it('shows "Idle" status when no timer running', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: { ...employeeDashboardResponse, timer: null } });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Idle')).toBeInTheDocument();
      });
    });

    it('shows "Tracking" status when timer is running', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard')
          return Promise.resolve({
            data: { ...employeeDashboardResponse, timer: { elapsed_seconds: 1200 } },
          });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Tracking')).toBeInTheDocument();
      });
    });

    it('does NOT render team activity table for employees', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: employeeDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Status')).toBeInTheDocument();
      });

      expect(screen.queryByText('Team Activity')).not.toBeInTheDocument();
    });

    it('renders weekly hours target progress bar', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: employeeDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Weekly Target')).toBeInTheDocument();
      });

      expect(screen.getByText(/40h required/)).toBeInTheDocument();
    });

    it('renders daily hours chart', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: employeeDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Daily Hours')).toBeInTheDocument();
      });
    });
  });

  // ── Error State ───────────────────────────────────────────────

  describe('error state', () => {
    it('renders error message when dashboard API fails', async () => {
      mockUser.mockReturnValue({
        id: 'user-1',
        name: 'Test User',
        role: 'owner',
      });

      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.reject(new Error('API Error'));
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(
          screen.getByText('Failed to load dashboard data. Please try again.')
        ).toBeInTheDocument();
      });
    });
  });

  // ── Loading State ─────────────────────────────────────────────

  describe('loading state', () => {
    it('renders loading skeleton for stat cards', async () => {
      mockUser.mockReturnValue({
        id: 'user-1',
        name: 'Test User',
        role: 'owner',
      });

      // Never resolve to keep loading state
      mockApiGet.mockImplementation(() => new Promise(() => {}));

      renderDashboard();

      // Check for loading pulse animations
      const pulses = document.querySelectorAll('.animate-pulse');
      expect(pulses.length).toBeGreaterThan(0);
    });
  });

  // ── Timesheet ─────────────────────────────────────────────────

  describe('timesheet', () => {
    beforeEach(() => {
      mockUser.mockReturnValue({
        id: 'user-1',
        name: 'Test User',
        role: 'owner',
      });
    });

    it('renders timesheet section with entries', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: timeEntriesResponse });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('Dashboard redesign')).toBeInTheDocument();
      });

      expect(screen.getByText('Timesheet')).toBeInTheDocument();
    });

    it('shows "No time entries" message when empty', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: { data: [] } });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText('No time entries in this range')).toBeInTheDocument();
      });
    });

    it('renders running entry with green indicator', async () => {
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: timeEntriesResponse });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      await waitFor(() => {
        // Running entry should have the green dot indicator
        const runningIndicators = document.querySelectorAll('.text-green-400');
        expect(runningIndicators.length).toBeGreaterThan(0);
      });
    });
  });

  // ── DateFilter ────────────────────────────────────────────────

  describe('date filter', () => {
    it('renders DateFilter component', async () => {
      mockUser.mockReturnValue({
        id: 'user-1',
        name: 'Test User',
        role: 'owner',
      });

      mockApiGet.mockImplementation((url: string) => {
        if (url === '/dashboard') return Promise.resolve({ data: adminDashboardResponse });
        if (url === '/time-entries') return Promise.resolve({ data: timeEntriesResponse });
        return Promise.resolve({ data: {} });
      });

      renderDashboard();

      expect(screen.getByTestId('date-filter')).toBeInTheDocument();
      expect(screen.getByTestId('filter-preset')).toHaveTextContent('today');
    });
  });
});
