import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  useRegularizations,
  useApproveRegularization,
  useRejectRegularization,
} from '@/hooks/hr/use-regularizations';

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

const mockRegularizations = {
  data: [
    { id: 'reg-1', user_id: 'u-1', attendance_record_id: 'att-1', current_status: 'absent', requested_status: 'present', reason: 'Was remote', status: 'pending', review_note: null, reviewed_at: null, created_at: '2026-03-31', updated_at: '2026-03-31' },
  ],
  meta: { current_page: 1, last_page: 1, total: 1, from: 1, to: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRegularizations', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRegularizations(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns regularizations on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockRegularizations });
    const { result } = renderHook(() => useRegularizations(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('sends status filter when not all', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockRegularizations });
    renderHook(() => useRegularizations({ status: 'pending', page: 2 }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/attendance/regularizations', {
      params: { status: 'pending', page: 2 },
    });
  });

  it('excludes status when set to all', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockRegularizations });
    renderHook(() => useRegularizations({ status: 'all' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const callParams = vi.mocked(api.get).mock.calls[0][1]?.params;
    expect(callParams).not.toHaveProperty('status');
  });
});

describe('useApproveRegularization', () => {
  it('calls PUT with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useApproveRegularization(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('reg-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/attendance/regularizations/reg-1/approve');
    expect(toast.success).toHaveBeenCalledWith('Regularization approved');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockRejectedValue(new Error('Not authorized'));

    const { result } = renderHook(() => useApproveRegularization(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('reg-1');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useRejectRegularization', () => {
  it('calls PUT with id and review_note', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useRejectRegularization(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'reg-1', review_note: 'No evidence provided' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/attendance/regularizations/reg-1/reject', {
      review_note: 'No evidence provided',
    });
    expect(toast.success).toHaveBeenCalledWith('Regularization rejected');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockRejectedValue({ message: 'Already processed' });

    const { result } = renderHook(() => useRejectRegularization(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'reg-1', review_note: 'Reason' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});
