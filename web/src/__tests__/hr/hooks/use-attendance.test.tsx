import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  useAttendance,
  useTeamAttendance,
  useAttendanceSummary,
  useRequestRegularization,
  useGenerateAttendance,
} from '@/hooks/hr/use-attendance';

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

const mockAttendance = {
  data: [
    { id: 'att-1', user_id: 'u-1', date: '2026-03-31', status: 'present', clock_in: '09:00', clock_out: '17:30', total_hours: 8.5, late_minutes: 0, created_at: '2026-03-31', updated_at: '2026-03-31' },
  ],
  meta: { current_page: 1, last_page: 1, total: 1, from: 1, to: 1 },
};

const mockSummary = {
  total_working_days: 22,
  present_days: 20,
  absent_days: 1,
  half_days: 1,
  leave_days: 0,
  late_count: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useAttendance', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAttendance(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns attendance data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockAttendance });
    const { result } = renderHook(() => useAttendance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('sends correct API path with date filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockAttendance });
    renderHook(() => useAttendance({ start_date: '2026-03-01', end_date: '2026-03-31' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/attendance', {
      params: { start_date: '2026-03-01', end_date: '2026-03-31' },
    });
  });

  it('excludes status when set to all', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockAttendance });
    renderHook(() => useAttendance({ status: 'all' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const callParams = vi.mocked(api.get).mock.calls[0][1]?.params;
    expect(callParams).not.toHaveProperty('status');
  });
});

describe('useTeamAttendance', () => {
  it('returns team attendance on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockAttendance });
    const { result } = renderHook(() => useTeamAttendance(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/hr/attendance/team', { params: {} });
  });

  it('sends department_id filter', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockAttendance });
    renderHook(() => useTeamAttendance({ department_id: 'dept-1' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/attendance/team', {
      params: { department_id: 'dept-1' },
    });
  });
});

describe('useAttendanceSummary', () => {
  it('returns summary on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockSummary } });
    const { result } = renderHook(() => useAttendanceSummary(3, 2026), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total_working_days).toBe(22);
  });

  it('sends correct month and year params', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockSummary } });
    renderHook(() => useAttendanceSummary(3, 2026), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/attendance/summary', {
      params: { month: 3, year: 2026 },
    }));
  });
});

describe('useRequestRegularization', () => {
  it('calls POST with correct endpoint and data', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useRequestRegularization(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        attendance_record_id: 'att-1',
        requested_status: 'present',
        reason: 'Was working from home',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/attendance/att-1/regularize', {
      requested_status: 'present',
      reason: 'Was working from home',
    });
    expect(toast.success).toHaveBeenCalledWith('Regularization request submitted');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue({ message: 'Already requested' });

    const { result } = renderHook(() => useRequestRegularization(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ attendance_record_id: 'att-1', requested_status: 'present', reason: 'Test' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useGenerateAttendance', () => {
  it('calls POST to generate endpoint and shows success toast', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useGenerateAttendance(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/attendance/generate');
    expect(toast.success).toHaveBeenCalledWith('Attendance generation triggered');
  });
});
