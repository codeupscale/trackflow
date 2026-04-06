import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { usePayslips, usePayslip } from '@/hooks/hr/use-payslips';

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

const mockPayslips = [
  {
    id: 'ps-1',
    user_id: 'u-1',
    payroll_period_id: 'pp-1',
    gross_salary: '10000.00',
    total_deductions: '3000.00',
    total_allowances: '500.00',
    net_salary: '7500.00',
    status: 'draft',
    payment_date: null,
    payment_method: null,
    notes: null,
    user: { id: 'u-1', name: 'John', email: 'john@test.com', avatar_url: null },
    payroll_period: { id: 'pp-1', name: 'March 2026', start_date: '2026-03-01', end_date: '2026-03-31', status: 'draft' },
    created_at: '2026-03-01',
    updated_at: '2026-03-01',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePayslips', () => {
  it('returns paginated payslips', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: mockPayslips,
        current_page: 1,
        last_page: 1,
        per_page: 25,
        total: 1,
        from: 1,
        to: 1,
      },
    });
    const { result } = renderHook(() => usePayslips(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0].gross_salary).toBe('10000.00');
  });

  it('filters by user_id', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, per_page: 25, total: 0 } });
    renderHook(() => usePayslips({ user_id: 'u-1' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/payslips', {
      params: expect.objectContaining({ user_id: 'u-1' }),
    }));
  });

  it('filters by payroll_period_id', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, per_page: 25, total: 0 } });
    renderHook(() => usePayslips({ payroll_period_id: 'pp-1' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/payslips', {
      params: expect.objectContaining({ payroll_period_id: 'pp-1' }),
    }));
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => usePayslips(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('usePayslip', () => {
  it('fetches single payslip with line items', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: { ...mockPayslips[0], line_items: [] } } });
    const { result } = renderHook(() => usePayslip('ps-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.id).toBe('ps-1');
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHook(() => usePayslip(undefined), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
  });
});
