import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useApproveLeave, useRejectLeave, useCancelLeave } from '@/hooks/hr/use-leave-actions';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useApproveLeave', () => {
  it('calls PUT with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useApproveLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('lr-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/leave-requests/lr-1/approve');
    expect(toast.success).toHaveBeenCalledWith('Leave request approved');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockRejectedValue({ message: 'Not authorized' });

    const { result } = renderHook(() => useApproveLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('lr-1');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useRejectLeave', () => {
  it('calls PUT with id and rejection reason', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useRejectLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'lr-2', rejection_reason: 'Team capacity' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/leave-requests/lr-2/reject', { rejection_reason: 'Team capacity' });
    expect(toast.success).toHaveBeenCalledWith('Leave request rejected');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockRejectedValue(new Error('Server error'));

    const { result } = renderHook(() => useRejectLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'lr-2', rejection_reason: 'Reason' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useCancelLeave', () => {
  it('calls DELETE with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useCancelLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('lr-3');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/hr/leave-requests/lr-3');
    expect(toast.success).toHaveBeenCalledWith('Leave request cancelled');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockRejectedValue({ message: 'Cannot cancel' });

    const { result } = renderHook(() => useCancelLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('lr-3');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});
