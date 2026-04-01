import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useLeaveTypes } from '@/hooks/hr/use-leave-types';

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

const mockLeaveTypes = [
  { id: 'lt-1', name: 'Annual Leave', code: 'AL', type: 'paid', days_per_year: 20, accrual_method: 'annual', max_carry_over: 5, is_active: true, created_at: '2024-01-01', updated_at: '2024-01-01' },
  { id: 'lt-2', name: 'Sick Leave', code: 'SL', type: 'paid', days_per_year: 10, accrual_method: 'annual', max_carry_over: 0, is_active: true, created_at: '2024-01-01', updated_at: '2024-01-01' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeaveTypes', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLeaveTypes(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns data on success with nested data field', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockLeaveTypes } });
    const { result } = renderHook(() => useLeaveTypes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe('Annual Leave');
  });

  it('returns data when response has no nested data field', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockLeaveTypes });
    const { result } = renderHook(() => useLeaveTypes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it('calls correct API endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockLeaveTypes } });
    renderHook(() => useLeaveTypes(), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/leave-types'));
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => useLeaveTypes(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
