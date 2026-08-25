import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CheckInCard } from '@/components/hr/CheckInCard';
import type { TodayStatus } from '@/lib/validations/attendance';

// CheckInCard calls useQueryClient() directly, so it needs a real provider even though
// the data/mutation hooks are mocked below.
function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CheckInCard />
    </QueryClientProvider>
  );
}

// ── Mock the data/mutation hooks so we can drive the state machine directly. ──
const mockUseTodayStatus = vi.fn();
const mockCheckInMutate = vi.fn();
const mockCheckOutMutate = vi.fn();

vi.mock('@/hooks/hr/use-check-in', () => ({
  useTodayStatus: () => mockUseTodayStatus(),
  useCheckIn: () => ({ mutate: mockCheckInMutate, isPending: false }),
  useCheckOut: () => ({ mutate: mockCheckOutMutate, isPending: false }),
}));

const BASE_POLICY = {
  check_in_time: '11:30:00',
  late_threshold: '11:45:00',
  checkout_time: '20:30:00',
  timezone: 'UTC',
};

function makeStatus(overrides: Partial<TodayStatus>): TodayStatus {
  return {
    checked_in: false,
    checked_out: false,
    check_in_at: null,
    check_in_at_local: null,
    check_out_at: null,
    check_out_at_local: null,
    check_in_status: null,
    is_early_checkout: false,
    missing_checkout: false,
    worked_seconds: null,
    worked_hhmm: null,
    status: null,
    check_in_flags: null,
    server_now: '2026-07-03T12:00:00.000Z',
    has_open_session: false,
    can_check_in: true,
    can_check_out: false,
    sessions_count: 0,
    closed_worked_seconds: 0,
    open_check_in_at: null,
    sessions: [],
    policy: BASE_POLICY,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CheckInCard — state machine', () => {
  it('renders the loading skeleton', () => {
    mockUseTodayStatus.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderCard();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the error card on isError', () => {
    mockUseTodayStatus.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    renderCard();
    expect(screen.getByText(/failed to load check-in status/i)).toBeInTheDocument();
  });

  it('not_checked_in: prompts to check in with a "Check In" button', () => {
    mockUseTodayStatus.mockReturnValue({
      isLoading: false,
      isError: false,
      data: makeStatus({ sessions_count: 0, can_check_in: true }),
    });
    renderCard();
    expect(screen.getByText(/not checked in today/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Check In$/i })).toBeInTheDocument();
  });

  it('live: shows the day-total ticker as HH:MM:SS and a Check Out button', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    mockUseTodayStatus.mockReturnValue({
      isLoading: false,
      isError: false,
      data: makeStatus({
        checked_in: true,
        has_open_session: true,
        can_check_in: false,
        can_check_out: true,
        sessions_count: 1,
        closed_worked_seconds: 0,
        // open session started 5 min before server_now → ticker ≈ 00:05:00
        open_check_in_at: '2026-07-03T11:55:00.000Z',
        check_in_at: '2026-07-03T11:55:00.000Z',
        sessions: [
          {
            seq: 1,
            check_in_at: '2026-07-03T11:55:00.000Z',
            check_in_at_local: '11:55',
            check_out_at: null,
            check_out_at_local: null,
            worked_seconds: null,
            worked_hhmm: null,
            is_open: true,
          },
        ],
      }),
    });
    renderCard();
    // Live ticker uses HH:MM:SS — never "Xm worked".
    expect(screen.getByLabelText(/total time worked today/i)).toHaveTextContent('00:05:00');
    expect(screen.getByRole('button', { name: /check out/i })).toBeInTheDocument();
    // In-progress session line.
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('idle_can_recheck: shows a frozen "Xh Ym" total and a "Check In again" button', () => {
    mockUseTodayStatus.mockReturnValue({
      isLoading: false,
      isError: false,
      data: makeStatus({
        checked_out: true,
        has_open_session: false,
        can_check_in: true,
        can_check_out: false,
        sessions_count: 2,
        closed_worked_seconds: 31800,
        worked_seconds: 31800, // 8h 50m
        worked_hhmm: '08:50',
        check_in_at: '2026-07-03T11:40:00.000Z',
        check_out_at: '2026-07-03T20:30:00.000Z',
        sessions: [
          {
            seq: 1,
            check_in_at: '2026-07-03T11:40:00.000Z',
            check_in_at_local: '11:40',
            check_out_at: '2026-07-03T14:34:00.000Z',
            check_out_at_local: '14:34',
            worked_seconds: 10440,
            worked_hhmm: '02:54',
            is_open: false,
          },
          {
            seq: 2,
            check_in_at: '2026-07-03T15:00:00.000Z',
            check_in_at_local: '15:00',
            check_out_at: '2026-07-03T20:30:00.000Z',
            check_out_at_local: '20:30',
            worked_seconds: 21360,
            worked_hhmm: '05:56',
            is_open: false,
          },
        ],
      }),
    });
    renderCard();
    // Frozen total is the unambiguous duration scheme, NOT a running clock.
    expect(screen.getByText('8h 50m')).toBeInTheDocument();
    expect(screen.queryByText(/\d\d:\d\d:\d\d/)).toBeNull();
    // Per-session durations also use the duration scheme.
    expect(screen.getByText('2h 54m')).toBeInTheDocument();
    expect(screen.getByText('5h 56m')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check in again/i })).toBeInTheDocument();
  });
});
