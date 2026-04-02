import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  PayComponent,
  PayComponentFormData,
  PaginatedResponse,
} from '@/lib/validations/payroll';
import { toast } from 'sonner';

export interface UsePayComponentsParams {
  type?: string;
  page?: number;
  per_page?: number;
}

export function usePayComponents(params?: UsePayComponentsParams) {
  return useQuery<PaginatedResponse<PayComponent>>({
    queryKey: ['pay-components', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.per_page) queryParams.per_page = params.per_page;
      if (params?.type) queryParams.type = params.type;
      const res = await api.get('/hr/pay-components', { params: queryParams });
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

export function useCreatePayComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: PayComponentFormData) => {
      const res = await api.post('/hr/pay-components', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-components'] });
      toast.success('Pay component created');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create pay component');
    },
  });
}

export function useUpdatePayComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PayComponentFormData> }) => {
      const res = await api.put(`/hr/pay-components/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-components'] });
      toast.success('Pay component updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update pay component');
    },
  });
}

export function useDeletePayComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/pay-components/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pay-components'] });
      toast.success('Pay component deleted');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete pay component');
    },
  });
}
