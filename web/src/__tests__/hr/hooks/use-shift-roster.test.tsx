import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useShiftRoster } from '@/hooks/hr/use-shift-roster';

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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockRoster = {
  data: {
    '2026-03-30': [
      {
        shift: {
          id: 'shift-1',
          organization_id: 'org-1',
          name: 'Morning Shift',
          start_time: '09:00',
          end_time: '17:00',
          days_of_week: ['monday'],
          break_minutes: 60,
          grace_period_minutes: 15,
          color: '#3B82F6',
          timezone: 'UTC',
          description: null,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
        },
        users: [
          { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com' },
          { id: 'u-2', name: 'John Smith', email: 'john@example.com' },
        ],
      },
    ],
    '2026-03-31': [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useShiftRoster', () => {
  it('fetches roster with week_start param', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockRoster });
    const { result } = renderHook(() => useShiftRoster('2026-03-30'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/hr/shifts/roster', {
      params: { week_start: '2026-03-30' },
    });
  });

  it('returns roster data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockRoster });
    const { result } = renderHook(() => useShiftRoster('2026-03-30'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.['2026-03-30']).toHaveLength(1);
    expect(result.current.data?.['2026-03-30'][0].users).toHaveLength(2);
  });

  it('does not fetch when weekStart is empty', () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockRoster });
    const { result } = renderHook(() => useShiftRoster(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });
});
