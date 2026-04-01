import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  usePositions,
  useCreatePosition,
  useUpdatePosition,
  useArchivePosition,
} from '@/hooks/hr/use-positions';

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

const mockPositions = {
  data: [
    { id: 'pos-1', title: 'Senior Engineer', code: 'SE-001', department_id: 'dept-1', level: 'senior', employment_type: 'full_time', min_salary: null, max_salary: null, is_active: true, created_at: '2024-01-01', updated_at: '2024-01-01' },
  ],
  meta: { current_page: 1, last_page: 1, total: 1, from: 1, to: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePositions', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePositions(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPositions });
    const { result } = renderHook(() => usePositions(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0].title).toBe('Senior Engineer');
  });

  it('sends correct API path with department_id filter', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPositions });
    renderHook(() => usePositions({ department_id: 'dept-1', page: 2 }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/positions', {
      params: { department_id: 'dept-1', page: 2 },
    });
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Server error'));
    const { result } = renderHook(() => usePositions(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreatePosition', () => {
  it('calls POST with correct data and shows success toast', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'pos-new' } });

    const { result } = renderHook(() => useCreatePosition(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ title: 'Junior Dev', code: 'JD-001', department_id: 'dept-1', level: 'junior', employment_type: 'full_time', min_salary: null, max_salary: null, is_active: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/positions', expect.objectContaining({ title: 'Junior Dev' }));
    expect(toast.success).toHaveBeenCalledWith('Position created successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('Duplicate code'));

    const { result } = renderHook(() => useCreatePosition(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ title: 'Test', code: 'T', department_id: 'd', level: 'mid', employment_type: 'full_time', min_salary: null, max_salary: null, is_active: true });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Duplicate code');
  });
});

describe('useUpdatePosition', () => {
  it('calls PUT with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: { id: 'pos-1' } });

    const { result } = renderHook(() => useUpdatePosition(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'pos-1', title: 'Lead Engineer', code: 'LE-001', department_id: 'dept-1', level: 'lead', employment_type: 'full_time', min_salary: null, max_salary: null, is_active: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/positions/pos-1', expect.objectContaining({ title: 'Lead Engineer' }));
    expect(toast.success).toHaveBeenCalledWith('Position updated successfully');
  });
});

describe('useArchivePosition', () => {
  it('calls DELETE and shows success toast', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useArchivePosition(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('pos-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/hr/positions/pos-1');
    expect(toast.success).toHaveBeenCalledWith('Position archived successfully');
  });
});
