import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  useShiftAssignments,
  useAssignShift,
  useUnassignShift,
  useBulkAssignShift,
} from '@/hooks/hr/use-shift-assignments';

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

const mockPaginatedAssignments = {
  data: [
    {
      id: 'assign-1',
      user_id: 'u-1',
      shift_id: 'shift-1',
      effective_from: '2026-04-01',
      effective_to: null,
      user: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com' },
    },
    {
      id: 'assign-2',
      user_id: 'u-2',
      shift_id: 'shift-1',
      effective_from: '2026-04-01',
      effective_to: '2026-06-30',
      user: { id: 'u-2', name: 'John Smith', email: 'john@example.com' },
    },
  ],
  current_page: 1,
  last_page: 1,
  total: 2,
  from: 1,
  to: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useShiftAssignments', () => {
  it('fetches assignments for a given shift', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedAssignments });
    const { result } = renderHook(() => useShiftAssignments('shift-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/hr/shifts/shift-1/assignments');
    expect(result.current.data?.data).toHaveLength(2);
  });

  it('does not fetch when shiftId is empty', () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedAssignments });
    const { result } = renderHook(() => useShiftAssignments(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('useAssignShift', () => {
  it('calls POST with user_id and dates', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'assign-new' } });

    const { result } = renderHook(() => useAssignShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        shiftId: 'shift-1',
        user_id: 'u-3',
        effective_from: '2026-04-15',
        effective_to: '2026-12-31',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/shifts/shift-1/assign', {
      user_id: 'u-3',
      effective_from: '2026-04-15',
      effective_to: '2026-12-31',
    });
    expect(toast.success).toHaveBeenCalledWith('User assigned to shift successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('Failed to assign user to shift'));

    const { result } = renderHook(() => useAssignShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        shiftId: 'shift-1',
        user_id: 'u-3',
        effective_from: '2026-04-15',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Failed to assign user to shift');
  });
});

describe('useUnassignShift', () => {
  it('calls POST /unassign with user_id', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useUnassignShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ shiftId: 'shift-1', userId: 'u-1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/shifts/shift-1/unassign', {
      user_id: 'u-1',
    });
    expect(toast.success).toHaveBeenCalledWith('User unassigned from shift');
  });
});

describe('useBulkAssignShift', () => {
  it('calls POST /bulk-assign with user_ids array', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useBulkAssignShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        shiftId: 'shift-1',
        user_ids: ['u-1', 'u-2', 'u-3'],
        effective_from: '2026-04-01',
        effective_to: '2026-06-30',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/shifts/shift-1/bulk-assign', {
      user_ids: ['u-1', 'u-2', 'u-3'],
      effective_from: '2026-04-01',
      effective_to: '2026-06-30',
    });
    expect(toast.success).toHaveBeenCalledWith('Users assigned to shift successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('Failed to bulk assign users'));

    const { result } = renderHook(() => useBulkAssignShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        shiftId: 'shift-1',
        user_ids: ['u-1'],
        effective_from: '2026-04-01',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Failed to bulk assign users');
  });
});
