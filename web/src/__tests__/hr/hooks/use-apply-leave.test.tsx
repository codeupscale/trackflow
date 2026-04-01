import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useApplyLeave } from '@/hooks/hr/use-apply-leave';

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

describe('useApplyLeave', () => {
  it('calls POST with JSON data when no document', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'lr-new' } });

    const { result } = renderHook(() => useApplyLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        leave_type_id: 'lt-1',
        start_date: '2026-04-01',
        end_date: '2026-04-03',
        reason: 'Vacation',
        half_day: false,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/leave-requests', {
      leave_type_id: 'lt-1',
      start_date: '2026-04-01',
      end_date: '2026-04-03',
      reason: 'Vacation',
      half_day: false,
    });
    expect(toast.success).toHaveBeenCalledWith('Leave request submitted');
  });

  it('calls POST with FormData when document is attached', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'lr-new' } });

    const { result } = renderHook(() => useApplyLeave(), { wrapper: createWrapper() });
    const mockFile = new File(['content'], 'doc.pdf', { type: 'application/pdf' });

    await act(async () => {
      result.current.mutate({
        leave_type_id: 'lt-1',
        start_date: '2026-04-01',
        end_date: '2026-04-03',
        reason: 'Medical',
        half_day: false,
        document: mockFile,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const callArgs = vi.mocked(api.post).mock.calls[0];
    expect(callArgs[0]).toBe('/hr/leave-requests');
    expect(callArgs[1]).toBeInstanceOf(FormData);
    expect(callArgs[2]).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue({ message: 'Insufficient balance' });

    const { result } = renderHook(() => useApplyLeave(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        leave_type_id: 'lt-1',
        start_date: '2026-04-01',
        end_date: '2026-04-03',
        reason: 'Test',
        half_day: false,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});
