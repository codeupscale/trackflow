import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useLeaveRequests } from '@/hooks/hr/use-leave-requests';

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

const mockLeaveRequests = {
  data: [
    { id: 'lr-1', user_id: 'u-1', leave_type_id: 'lt-1', start_date: '2026-03-20', end_date: '2026-03-22', days: 3, half_day: false, reason: 'Vacation', status: 'pending', rejection_reason: null, document_url: null, user: { id: 'u-1', name: 'Jane', email: 'jane@test.com', avatar_url: null }, leave_type: { id: 'lt-1', name: 'Annual', code: 'AL', type: 'paid', days_per_year: 20, accrual_method: 'annual', max_carry_over: 5, is_active: true, created_at: '2024-01-01', updated_at: '2024-01-01' }, approved_by: null, created_at: '2026-03-15', updated_at: '2026-03-15' },
  ],
  current_page: 1,
  last_page: 1,
  total: 1,
  from: 1,
  to: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeaveRequests', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLeaveRequests(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockLeaveRequests });
    const { result } = renderHook(() => useLeaveRequests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.total).toBe(1);
  });

  it('sends correct API path with filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockLeaveRequests });
    renderHook(
      () => useLeaveRequests({ status: 'pending', leave_type_id: 'lt-1', page: 2 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/leave-requests', {
      params: { status: 'pending', leave_type_id: 'lt-1', page: 2 },
    });
  });

  it('excludes status param when set to all', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockLeaveRequests });
    renderHook(() => useLeaveRequests({ status: 'all' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/leave-requests', { params: {} });
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Server error'));
    const { result } = renderHook(() => useLeaveRequests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
