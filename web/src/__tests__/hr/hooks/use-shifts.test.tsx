import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  useShifts,
  useShift,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
} from '@/hooks/hr/use-shifts';

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

const mockPaginatedShifts = {
  data: [
    {
      id: 'shift-1',
      organization_id: 'org-1',
      name: 'Morning Shift',
      start_time: '09:00',
      end_time: '17:00',
      days_of_week: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      break_minutes: 60,
      grace_period_minutes: 15,
      color: '#3B82F6',
      timezone: 'UTC',
      description: null,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'shift-2',
      organization_id: 'org-1',
      name: 'Night Shift',
      start_time: '22:00',
      end_time: '06:00',
      days_of_week: ['monday', 'tuesday', 'wednesday'],
      break_minutes: 30,
      grace_period_minutes: 10,
      color: '#8B5CF6',
      timezone: 'UTC',
      description: 'Overnight operations',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
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

describe('useShifts', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useShifts(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedShifts });
    const { result } = renderHook(() => useShifts(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(2);
    expect(result.current.data?.data[0].name).toBe('Morning Shift');
  });

  it('sends correct params (is_active, search, page)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedShifts });
    renderHook(() => useShifts({ is_active: true, search: 'morning', page: 2 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/shifts', {
      params: { is_active: true, search: 'morning', page: 2 },
    });
  });

  it('omits empty filter values from params', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedShifts });
    renderHook(() => useShifts({ search: '' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const callParams = vi.mocked(api.get).mock.calls[0][1]?.params;
    expect(callParams).not.toHaveProperty('search');
  });
});

describe('useShift', () => {
  it('fetches a single shift by id', async () => {
    const singleShift = mockPaginatedShifts.data[0];
    vi.mocked(api.get).mockResolvedValue({ data: { data: singleShift } });
    const { result } = renderHook(() => useShift('shift-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/hr/shifts/shift-1');
    expect(result.current.data?.name).toBe('Morning Shift');
  });
});

describe('useCreateShift', () => {
  it('calls POST /hr/shifts and shows success toast', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'shift-new', name: 'Evening Shift' } });

    const { result } = renderHook(() => useCreateShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        name: 'Evening Shift',
        start_time: '16:00',
        end_time: '00:00',
        days_of_week: ['monday', 'friday'],
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith(
      '/hr/shifts',
      expect.objectContaining({ name: 'Evening Shift', start_time: '16:00' })
    );
    expect(toast.success).toHaveBeenCalledWith('Shift created successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('Validation failed'));

    const { result } = renderHook(() => useCreateShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        name: '',
        start_time: '09:00',
        end_time: '17:00',
        days_of_week: ['monday'],
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Validation failed');
  });
});

describe('useUpdateShift', () => {
  it('calls PUT /hr/shifts/{id} and shows success toast', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: { id: 'shift-1', name: 'Morning Shift v2' } });

    const { result } = renderHook(() => useUpdateShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        id: 'shift-1',
        name: 'Morning Shift v2',
        start_time: '08:00',
        end_time: '16:00',
        days_of_week: ['monday', 'tuesday'],
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith(
      '/hr/shifts/shift-1',
      expect.objectContaining({ name: 'Morning Shift v2' })
    );
    expect(toast.success).toHaveBeenCalledWith('Shift updated successfully');
  });
});

describe('useDeleteShift', () => {
  it('calls DELETE /hr/shifts/{id} and shows success toast', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('shift-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/hr/shifts/shift-1');
    expect(toast.success).toHaveBeenCalledWith('Shift deleted successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockRejectedValue(new Error('Cannot delete shift with active assignments'));

    const { result } = renderHook(() => useDeleteShift(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('shift-1');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Cannot delete shift with active assignments');
  });
});
