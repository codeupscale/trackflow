import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useOvertimeRules, useUpdateOvertimeRules } from '@/hooks/hr/use-overtime-rules';

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

const mockOvertimeRules = {
  id: 'ot-1',
  organization_id: 'org-1',
  daily_threshold_hours: 8,
  weekly_threshold_hours: 40,
  overtime_multiplier: 1.5,
  weekend_multiplier: 2.0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useOvertimeRules', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useOvertimeRules(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns overtime rules on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockOvertimeRules } });
    const { result } = renderHook(() => useOvertimeRules(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.daily_threshold_hours).toBe(8);
  });

  it('calls correct API endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: mockOvertimeRules } });
    renderHook(() => useOvertimeRules(), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/overtime-rules'));
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Server error'));
    const { result } = renderHook(() => useOvertimeRules(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateOvertimeRules', () => {
  it('calls PUT with correct endpoint and data', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useUpdateOvertimeRules(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        daily_threshold_hours: 9,
        weekly_threshold_hours: 45,
        overtime_multiplier: 1.5,
        weekend_multiplier: 2.0,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/overtime-rules', expect.objectContaining({ daily_threshold_hours: 9 }));
    expect(toast.success).toHaveBeenCalledWith('Overtime rules updated');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockRejectedValue(new Error('Validation failed'));

    const { result } = renderHook(() => useUpdateOvertimeRules(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({} as never);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalled();
  });
});
