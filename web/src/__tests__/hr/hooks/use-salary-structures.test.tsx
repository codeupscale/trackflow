import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import { useSalaryStructures } from '@/hooks/hr/use-salary-structures';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockStructures = [
  {
    id: 'ss-1',
    name: 'Senior Engineer',
    description: null,
    type: 'monthly',
    base_salary: '8000.00',
    currency: 'AUD',
    is_active: true,
    effective_from: '2026-01-01',
    effective_to: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSalaryStructures', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSalaryStructures(), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns paginated data on success', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        data: mockStructures,
        current_page: 1,
        last_page: 1,
        per_page: 25,
        total: 1,
        from: 1,
        to: 1,
      },
    });
    const { result } = renderHook(() => useSalaryStructures(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0].name).toBe('Senior Engineer');
  });

  it('calls correct API endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, per_page: 25, total: 0 } });
    renderHook(() => useSalaryStructures(), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/salary-structures', expect.anything()));
  });

  it('filters by type', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [], current_page: 1, last_page: 1, per_page: 25, total: 0 } });
    renderHook(() => useSalaryStructures({ type: 'hourly' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/hr/salary-structures', {
      params: expect.objectContaining({ type: 'hourly' }),
    }));
  });

  it('handles error state', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Failed'));
    const { result } = renderHook(() => useSalaryStructures(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
