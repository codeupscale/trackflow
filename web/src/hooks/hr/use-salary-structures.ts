import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  SalaryStructure,
  SalaryStructureFormData,
  PaginatedResponse,
} from '@/lib/validations/payroll';
import { toast } from 'sonner';

export interface UseSalaryStructuresParams {
  type?: string;
  is_active?: boolean;
  page?: number;
  per_page?: number;
}

export function useSalaryStructures(params?: UseSalaryStructuresParams) {
  return useQuery<PaginatedResponse<SalaryStructure>>({
    queryKey: ['salary-structures', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number | boolean> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.per_page) queryParams.per_page = params.per_page;
      if (params?.type) queryParams.type = params.type;
      if (params?.is_active !== undefined) queryParams.is_active = params.is_active;
      const res = await api.get('/hr/salary-structures', { params: queryParams });
      const raw = res.data;
      return {
        data: raw.data ?? [],
        meta: raw.meta ?? {
          current_page: raw.current_page ?? 1,
          last_page: raw.last_page ?? 1,
          per_page: raw.per_page ?? 25,
          total: raw.total ?? 0,
          from: raw.from ?? null,
          to: raw.to ?? null,
        },
      };
    },
  });
}

export function useCreateSalaryStructure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SalaryStructureFormData) => {
      const res = await api.post('/hr/salary-structures', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      toast.success('Salary structure created');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create salary structure');
    },
  });
}

export function useUpdateSalaryStructure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SalaryStructureFormData> }) => {
      const res = await api.put(`/hr/salary-structures/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      toast.success('Salary structure updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update salary structure');
    },
  });
}

export function useDeleteSalaryStructure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/salary-structures/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-structures'] });
      toast.success('Salary structure deleted');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete salary structure');
    },
  });
}
