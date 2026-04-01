import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useEmployees, useEmployee, useUpdateEmployeeProfile } from '@/hooks/hr/use-employees';

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

const mockEmployeesList = {
  data: [
    { id: 'e-1', name: 'Jane Doe', email: 'jane@test.com', employee_id: 'EMP-001', employment_status: 'active', employment_type: 'full_time', department: { id: 'dept-1', name: 'Engineering' }, position: { id: 'pos-1', title: 'Senior Engineer' }, avatar_url: null },
  ],
  meta: { current_page: 1, last_page: 1, per_page: 15, total: 1, from: 1, to: 1 },
};

const mockEmployeeDetail = {
  data: {
    id: 'e-1',
    name: 'Jane Doe',
    email: 'jane@test.com',
    employee_id: 'EMP-001',
    employment_status: 'active',
    employment_type: 'full_time',
    department: { id: 'dept-1', name: 'Engineering' },
    position: { id: 'pos-1', title: 'Senior Engineer' },
    gender: 'female',
    nationality: 'Australian',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useEmployees', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useEmployees(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns employee list on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockEmployeesList });
    const { result } = renderHook(() => useEmployees(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('sends correct API path with search and filters', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockEmployeesList });
    renderHook(() => useEmployees({ search: 'Jane', department_id: 'dept-1', page: 2 }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/employees', {
      params: { search: 'Jane', department_id: 'dept-1', page: 2 },
    });
  });

  it('excludes employment_status when set to all', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockEmployeesList });
    renderHook(() => useEmployees({ employment_status: 'all' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const callParams = vi.mocked(api.get).mock.calls[0][1]?.params;
    expect(callParams).not.toHaveProperty('employment_status');
  });
});

describe('useEmployee', () => {
  it('returns employee detail on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockEmployeeDetail });
    const { result } = renderHook(() => useEmployee('e-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.name).toBe('Jane Doe');
  });

  it('does not fetch when id is undefined', () => {
    const { result } = renderHook(() => useEmployee(undefined), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('calls correct API endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockEmployeeDetail });
    renderHook(() => useEmployee('e-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/employees/e-1'));
  });
});

describe('useUpdateEmployeeProfile', () => {
  it('calls PUT with correct endpoint and data', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useUpdateEmployeeProfile(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        id: 'e-1',
        data: { gender: 'female', nationality: 'Australian' } as never,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/employees/e-1/profile', expect.objectContaining({ gender: 'female' }));
    expect(toast.success).toHaveBeenCalledWith('Profile updated successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockRejectedValue(new Error('Forbidden'));

    const { result } = renderHook(() => useUpdateEmployeeProfile(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({ id: 'e-1', data: {} as never });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Forbidden');
  });
});
