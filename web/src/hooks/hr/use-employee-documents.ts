import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { EmployeeDocument } from '@/lib/validations/employee';
import { toast } from 'sonner';

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    from: number | null;
    to: number | null;
  };
}

interface UseEmployeeDocumentsParams {
  category?: string;
  is_verified?: boolean;
  page?: number;
}

export function useEmployeeDocuments(
  employeeId: string | undefined,
  params?: UseEmployeeDocumentsParams
) {
  return useQuery<PaginatedResponse<EmployeeDocument>>({
    queryKey: ['employee-documents', employeeId, params],
    queryFn: async () => {
      const queryParams: Record<string, string | number | boolean> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.category) queryParams.category = params.category;
      if (params?.is_verified !== undefined)
        queryParams.is_verified = params.is_verified;
      const res = await api.get(`/hr/employees/${employeeId}/documents`, {
        params: queryParams,
      });
      return res.data;
    },
    enabled: !!employeeId,
  });
}

export function useUploadDocument(employeeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await api.post(
        `/hr/employees/${employeeId}/documents`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['employee-documents', employeeId],
      });
      toast.success('Document uploaded successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to upload document');
    },
  });
}

export function useVerifyDocument(employeeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await api.put(
        `/hr/employees/${employeeId}/documents/${documentId}/verify`
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['employee-documents', employeeId],
      });
      toast.success('Document verified');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to verify document');
    },
  });
}

export function useDeleteDocument(employeeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await api.delete(
        `/hr/employees/${employeeId}/documents/${documentId}`
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['employee-documents', employeeId],
      });
      toast.success('Document deleted');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete document');
    },
  });
}
