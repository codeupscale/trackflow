import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { usePayrollPeriods, usePayrollPeriod } from '@/hooks/hr/use-payroll';

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

const mockPeriods = [
  {
    id: 'pp-1',
    name: 'March 2026',
    period_type: 'monthly',
    start_date: '2026-03-01',
    end_date: '2026-03-31',
    status: 'draft',
    processed_at: null,
    approved_by: null,
    payslips_count: 5,
    created_at: '2026-03-01',
    updated_at: '2026-03-01',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePayrollPeriods', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePayrollPeriods(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns paginated data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: mockPeriods,
        current_page: 1,
        last_page: 1,
        per_page: 25,
        total: 1,
        from: 1,
        to: 1,
      },
    });
    const { result } = renderHook(() => usePayrollPeriods(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0].name).toBe('March 2026');
    expect(result.current.data?.meta.total).toBe(1);
  });

  it('calls correct API endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockPeriods, current_page: 1, last_page: 1, per_page: 25, total: 1 } });
    renderHook(() => usePayrollPeriods(), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/payroll-periods', expect.anything()));
  });

  it('passes status filter to API', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, per_page: 25, total: 0 } });
    renderHook(() => usePayrollPeriods({ status: 'approved' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/payroll-periods', {
      params: expect.objectContaining({ status: 'approved' }),
    }));
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => usePayrollPeriods(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('usePayrollPeriod', () => {
  it('fetches single period detail', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockPeriods[0] } });
    const { result } = renderHook(() => usePayrollPeriod('pp-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.name).toBe('March 2026');
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHook(() => usePayrollPeriod(undefined), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
  });
});
