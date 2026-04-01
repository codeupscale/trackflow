import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useLeaveCalendar, usePublicHolidays } from '@/hooks/hr/use-leave-calendar';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockCalendarResponse = {
  calendar: {
    '2026-04-01': [
      {
        id: 'lr-1',
        user: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', avatar_url: null },
        user_name: 'Jane Doe',
        leave_type: { id: 'lt-1', code: 'AL', name: 'Annual Leave' },
        leave_type_name: 'Annual Leave',
        leave_type_code: 'AL',
        half_day: false,
        status: 'approved',
        days_count: 1,
        start_date: '2026-04-01',
        end_date: '2026-04-01',
      },
    ],
  },
  holidays: [
    { id: 'h-1', name: 'Good Friday', date: '2026-04-03', is_recurring: false },
  ],
};

const mockPublicHolidays = [
  { id: 'h-1', name: 'Good Friday', date: '2026-04-03', is_recurring: false, created_at: '2024-01-01', updated_at: '2024-01-01' },
  { id: 'h-2', name: 'ANZAC Day', date: '2026-04-25', is_recurring: true, created_at: '2024-01-01', updated_at: '2024-01-01' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeaveCalendar', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLeaveCalendar(4, 2026), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns calendar data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockCalendarResponse } });
    const { result } = renderHook(() => useLeaveCalendar(4, 2026), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.keys(result.current.data?.calendar ?? {})).toHaveLength(1);
    expect(result.current.data?.holidays).toHaveLength(1);
  });

  it('sends correct API path with month and year params', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockCalendarResponse } });
    renderHook(() => useLeaveCalendar(4, 2026), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/leave-calendar', {
      params: { month: 4, year: 2026 },
    });
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => useLeaveCalendar(4, 2026), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('usePublicHolidays', () => {
  it('returns public holidays on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockPublicHolidays } });
    const { result } = renderHook(() => usePublicHolidays(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it('calls correct API endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockPublicHolidays } });
    renderHook(() => usePublicHolidays(), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/public-holidays'));
  });
});
