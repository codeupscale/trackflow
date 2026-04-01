import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import api from '@/lib/api';
import {
  useEmployeeDocuments,
  useUploadDocument,
  useVerifyDocument,
  useDeleteDocument,
} from '@/hooks/hr/use-employee-documents';

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

const mockDocuments = {
  data: [
    { id: 'doc-1', title: 'Passport', category: 'identification', is_verified: false, download_url: 'https://example.com/doc.pdf', created_at: '2024-01-01', updated_at: '2024-01-01' },
  ],
  meta: { current_page: 1, last_page: 1, total: 1, from: 1, to: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useEmployeeDocuments', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useEmployeeDocuments('e-1'), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns documents on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDocuments });
    const { result } = renderHook(() => useEmployeeDocuments('e-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('does not fetch when employeeId is undefined', () => {
    const { result } = renderHook(() => useEmployeeDocuments(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('sends correct API path with category filter', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDocuments });
    renderHook(() => useEmployeeDocuments('e-1', { category: 'identification' }), { wrapper: createWrapper() });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get).toHaveBeenCalledWith('/hr/employees/e-1/documents', {
      params: { category: 'identification' },
    });
  });
});

describe('useUploadDocument', () => {
  it('calls POST with FormData and multipart header', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'doc-new' } });

    const { result } = renderHook(() => useUploadDocument('e-1'), { wrapper: createWrapper() });
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.pdf'));

    await act(async () => {
      result.current.mutate(formData);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/hr/employees/e-1/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    expect(toast.success).toHaveBeenCalledWith('Document uploaded successfully');
  });

  it('shows error toast on failure', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.post).mockRejectedValue(new Error('File too large'));

    const { result } = renderHook(() => useUploadDocument('e-1'), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate(new FormData());
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('File too large');
  });
});

describe('useVerifyDocument', () => {
  it('calls PUT with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useVerifyDocument('e-1'), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('doc-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledWith('/hr/employees/e-1/documents/doc-1/verify');
    expect(toast.success).toHaveBeenCalledWith('Document verified');
  });
});

describe('useDeleteDocument', () => {
  it('calls DELETE with correct endpoint', async () => {
    const { toast } = await import('sonner');
    vi.mocked(api.delete).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useDeleteDocument('e-1'), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate('doc-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.delete).toHaveBeenCalledWith('/hr/employees/e-1/documents/doc-1');
    expect(toast.success).toHaveBeenCalledWith('Document deleted');
  });
});
