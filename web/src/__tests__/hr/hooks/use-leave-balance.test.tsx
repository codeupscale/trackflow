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
    leave_type_id: 'lt-1',
    total_days: 20,
    used_days: 5,
    pending_days: 2,
    leave_type: { id: 'lt-1', name: 'Annual Leave', code: 'AL', type: 'paid' as const },
  },
  {
    leave_type_id: 'lt-2',
    total_days: 10,
    used_days: 2,
    pending_days: 0,
    leave_type: { id: 'lt-2', name: 'Sick Leave', code: 'SL', type: 'paid' as const },
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
    expect(annualBalance?.total_days).toBe(20);
    expect(annualBalance?.used_days).toBe(5);

    const sickBalance = result.current.getBalance('SL');
    expect(sickBalance?.total_days).toBe(10);
    expect(sickBalance?.used_days).toBe(2);
  });

  it('getBalance returns undefined for unknown type code', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockBalances } });
    const { result } = renderHook(() => useLeaveBalance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.balances).toBeDefined());
    expect(result.current.getBalance('XX')).toBeUndefined();
  });
});
