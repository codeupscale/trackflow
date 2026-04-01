import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useEmployeeNotes, useCreateNote, useDeleteNote } from '@/hooks/hr/use-employee-notes';

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

const mockNotes = {
  data: [
    { id: 'note-1', content: 'Great performance this quarter', is_confidential: false, created_by: { id: 'u-admin', name: 'Admin' }, created_at: '2026-03-01', updated_at: '2026-03-01' },
  ],
  meta: { current_page: 1, last_page: 1, total: 1, from: 1, to: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useEmployeeNotes', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useEmployeeNotes('e-1'), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns notes on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockNotes });
    const { result } = renderHook(() => useEmployeeNotes('e-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('does not fetch when employeeId is undefined', () => {
    const { result } = renderHook(() => useEmployeeNotes(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('calls correct API endpoint with pagination', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockNotes });
    renderHook(() => useEmployeeNotes('e-1', { page: 3 }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/employees/e-1/notes', {
      params: { page: 3 },
    });
  });
});

describe('useCreateNote', () => {
  it('calls POST with correct endpoint and data', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'note-new' } });

    const { result } = renderHook(() => useCreateNote('e-1'), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ content: 'New note', is_confidential: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/employees/e-1/notes', { content: 'New note', is_confidential: true });
    expect(toast.success).toHaveBeenCalledWith('Note added');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('Permission denied'));

    const { result } = renderHook(() => useCreateNote('e-1'), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ content: 'Test', is_confidential: false });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Permission denied');
  });
});

describe('useDeleteNote', () => {
  it('calls DELETE with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useDeleteNote('e-1'), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('note-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/hr/employees/e-1/notes/note-1');
    expect(toast.success).toHaveBeenCalledWith('Note deleted');
  });
});
