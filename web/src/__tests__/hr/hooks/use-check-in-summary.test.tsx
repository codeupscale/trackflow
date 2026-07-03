import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useCheckInsSummary } from '@/hooks/hr/use-check-in';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    data: { data: [], current_page: 1, last_page: 1, total: 0 },
  });
});

describe('useCheckInsSummary', () => {
  it('forwards the selected employee id as the user_id query param', async () => {
    renderHook(
      () =>
        useCheckInsSummary({
          period: 'month',
          month: '2026-07',
          user_id: 'user-mirza-2',
          page: 1,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(api.get).toHaveBeenCalled());

    expect(api.get).toHaveBeenCalledWith('/hr/attendance/check-ins/summary', {
      params: {
        period: 'month',
        month: '2026-07',
        user_id: 'user-mirza-2',
        page: 1,
      },
    });
  });

  it('omits user_id from the query when no employee is selected (null)', async () => {
    renderHook(
      () =>
        useCheckInsSummary({
          period: 'day',
          date: '2026-07-03',
          user_id: null,
          page: 1,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(api.get).toHaveBeenCalled());

    expect(api.get).toHaveBeenCalledWith('/hr/attendance/check-ins/summary', {
      params: { period: 'day', date: '2026-07-03', page: 1 },
    });
  });
});
