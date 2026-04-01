import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  useDepartments,
  useDepartmentTree,
  useCreateDepartment,
  useUpdateDepartment,
  useArchiveDepartment,
} from '@/hooks/hr/use-departments';

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

const mockPaginatedDepartments = {
  data: [
    { id: 'dept-1', name: 'Engineering', code: 'ENG', description: null, parent_department_id: null, manager_id: null, is_active: true, positions_count: 5, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
    { id: 'dept-2', name: 'Marketing', code: 'MKT', description: null, parent_department_id: null, manager_id: null, is_active: true, positions_count: 3, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
  ],
  meta: { current_page: 1, last_page: 1, total: 2, from: 1, to: 2 },
};

const mockDepartmentTree = {
  data: [
    { id: 'dept-1', name: 'Engineering', code: 'ENG', children: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDepartments', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDepartments(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedDepartments });
    const { result } = renderHook(() => useDepartments(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(2);
    expect(result.current.data?.data[0].name).toBe('Engineering');
  });

  it('sends correct API path and params', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockPaginatedDepartments });
    renderHook(() => useDepartments({ page: 2, is_active: true }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/departments', {
      params: { page: 2, is_active: true },
    });
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useDepartments(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useDepartmentTree', () => {
  it('returns tree data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDepartmentTree });
    const { result } = renderHook(() => useDepartmentTree(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('calls correct API endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDepartmentTree });
    renderHook(() => useDepartmentTree(), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/departments/tree'));
  });
});

describe('useCreateDepartment', () => {
  it('calls POST with correct data', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'dept-new', name: 'HR' } });

    const { result } = renderHook(() => useCreateDepartment(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ name: 'HR', code: 'HR', description: '', parent_department_id: null, manager_id: null, is_active: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/departments', expect.objectContaining({ name: 'HR', code: 'HR' }));
    expect(toast.success).toHaveBeenCalledWith('Department created successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('Validation failed'));

    const { result } = renderHook(() => useCreateDepartment(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ name: '', code: '', description: '', parent_department_id: null, manager_id: null, is_active: true });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Validation failed');
  });
});

describe('useUpdateDepartment', () => {
  it('calls PUT with correct endpoint and data', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: { id: 'dept-1', name: 'Engineering v2' } });

    const { result } = renderHook(() => useUpdateDepartment(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'dept-1', name: 'Engineering v2', code: 'ENG', description: '', parent_department_id: null, manager_id: null, is_active: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/departments/dept-1', expect.objectContaining({ name: 'Engineering v2' }));
    expect(toast.success).toHaveBeenCalledWith('Department updated successfully');
  });
});

describe('useArchiveDepartment', () => {
  it('calls DELETE with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useArchiveDepartment(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('dept-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/hr/departments/dept-1');
    expect(toast.success).toHaveBeenCalledWith('Department archived successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockRejectedValue(new Error('Cannot delete'));

    const { result } = renderHook(() => useArchiveDepartment(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('dept-1');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Cannot delete');
  });
});
