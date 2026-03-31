import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Department, DepartmentInput } from '@/lib/validations/department';
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

interface UseDepartmentsParams {
  is_active?: boolean;
  page?: number;
  parent_department_id?: string;
}

export function useDepartments(params?: UseDepartmentsParams) {
  return useQuery<PaginatedResponse<Department>>({
    queryKey: ['departments', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number | boolean> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.is_active !== undefined)
        queryParams.is_active = params.is_active;
      if (params?.parent_department_id)
        queryParams.parent_department_id = params.parent_department_id;
      const res = await api.get('/hr/departments', { params: queryParams });
      return res.data;
    },
  });
}

export function useDepartmentTree() {
  return useQuery<Department[]>({
    queryKey: ['departments', 'tree'],
    queryFn: async () => {
      const res = await api.get('/hr/departments/tree');
      return res.data.data;
    },
  });
}

export function useCreateDepartment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: DepartmentInput) => {
      const res = await api.post('/hr/departments', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department created successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create department');
    },
  });
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: DepartmentInput & { id: string }) => {
      const res = await api.put(`/hr/departments/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department updated successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update department');
    },
  });
}

export function useArchiveDepartment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/hr/departments/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department archived successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to archive department');
    },
  });
}
