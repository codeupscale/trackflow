import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useLeaveBalance } from '@/hooks/hr/use-leave-balance';

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

const mockBalances = [
  {
    id: 'lb-1',
    user_id: 'u-1',
    leave_type_id: 'lt-1',
    entitled: 20,
    used: 5,
    remaining: 15,
    carried_over: 2,
    leave_type: { id: 'lt-1', name: 'Annual Leave', code: 'AL', type: 'paid', days_per_year: 20, accrual_method: 'annual', max_carry_over: 5, is_active: true, created_at: '2024-01-01', updated_at: '2024-01-01' },
  },
  {
    id: 'lb-2',
    user_id: 'u-1',
    leave_type_id: 'lt-2',
    entitled: 10,
    used: 2,
    remaining: 8,
    carried_over: 0,
    leave_type: { id: 'lt-2', name: 'Sick Leave', code: 'SL', type: 'paid', days_per_year: 10, accrual_method: 'annual', max_carry_over: 0, is_active: true, created_at: '2024-01-01', updated_at: '2024-01-01' },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeaveBalance', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLeaveBalance(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns balances on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockBalances } });
    const { result } = renderHook(() => useLeaveBalance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balances).toHaveLength(2);
  });

  it('passes user_id param when provided', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockBalances } });
    renderHook(() => useLeaveBalance('u-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/leave-balances', {
      params: { user_id: 'u-1' },
    });
  });

  it('getBalance returns correct balance by type code', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockBalances } });
    const { result } = renderHook(() => useLeaveBalance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.balances).toBeDefined());
    const annualBalance = result.current.getBalance('AL');
    expect(annualBalance?.remaining).toBe(15);

    const sickBalance = result.current.getBalance('SL');
    expect(sickBalance?.remaining).toBe(8);
  });

  it('getBalance returns undefined for unknown type code', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockBalances } });
    const { result } = renderHook(() => useLeaveBalance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.balances).toBeDefined());
    expect(result.current.getBalance('XX')).toBeUndefined();
  });
});
