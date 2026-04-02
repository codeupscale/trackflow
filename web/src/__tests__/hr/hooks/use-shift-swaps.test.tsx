import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  useShiftSwaps,
  useCreateShiftSwap,
  useApproveSwap,
  useRejectSwap,
  useCancelSwap,
} from '@/hooks/hr/use-shift-swaps';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
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

const mockPaginatedSwaps = {
  data: [
    {
      id: 'swap-1',
      requester_id: 'u-1',
      target_user_id: 'u-2',
      requester_shift_id: 'shift-1',
      target_shift_id: 'shift-2',
      swap_date: '2026-04-05',
      reason: 'Need to attend appointment',
      status: 'pending' as const,
      reviewed_by: null,
      reviewed_at: null,
      reviewer_note: null,
      requester: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com' },
      target_user: { id: 'u-2', name: 'John Smith', email: 'john@example.com' },
      created_at: '2026-04-01T10:00:00Z',
    },
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

describe('useShiftSwaps', () => {
  it('returns paginated swap data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedSwaps });
    const { result } = renderHook(() => useShiftSwaps(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0].status).toBe('pending');
  });

  it('sends status and page filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedSwaps });
    renderHook(() => useShiftSwaps({ status: 'pending', page: 2 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/shift-swaps', {
      params: { status: 'pending', page: 2 },
    });
  });

  it('excludes status when set to all', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedSwaps });
    renderHook(() => useShiftSwaps({ status: 'all' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const callParams = vi.mocked(api.get).mock.calls[0][1]?.params;
    expect(callParams).not.toHaveProperty('status');
  });
});

describe('useCreateShiftSwap', () => {
  it('calls POST /hr/shift-swaps with correct data', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'swap-new' } });

    const { result } = renderHook(() => useCreateShiftSwap(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        target_user_id: 'u-2',
        swap_date: '2026-04-10',
        reason: 'Personal errand',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/shift-swaps', {
      target_user_id: 'u-2',
      swap_date: '2026-04-10',
      reason: 'Personal errand',
    });
    expect(toast.success).toHaveBeenCalledWith('Shift swap request submitted');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('Failed to submit swap request'));

    const { result } = renderHook(() => useCreateShiftSwap(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        target_user_id: 'u-2',
        swap_date: '2026-04-10',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Failed to submit swap request');
  });
});

describe('useApproveSwap', () => {
  it('calls PUT /hr/shift-swaps/{id}/approve', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useApproveSwap(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('swap-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/shift-swaps/swap-1/approve');
    expect(toast.success).toHaveBeenCalledWith('Swap request approved');
  });
});

describe('useRejectSwap', () => {
  it('calls PUT /hr/shift-swaps/{id}/reject with reviewer_note', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useRejectSwap(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        id: 'swap-1',
        reviewer_note: 'Insufficient coverage on that date',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/shift-swaps/swap-1/reject', {
      reviewer_note: 'Insufficient coverage on that date',
    });
    expect(toast.success).toHaveBeenCalledWith('Swap request rejected');
  });
});

describe('useCancelSwap', () => {
  it('calls DELETE /hr/shift-swaps/{id}', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useCancelSwap(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('swap-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/hr/shift-swaps/swap-1');
    expect(toast.success).toHaveBeenCalledWith('Swap request cancelled');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockRejectedValue(new Error('Failed to cancel swap request'));

    const { result } = renderHook(() => useCancelSwap(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('swap-1');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Failed to cancel swap request');
  });
});
