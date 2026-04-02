import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { PaginatedShifts, Shift, ShiftFormData } from '@/lib/validations/shift';

interface ShiftFilters {
  is_active?: boolean;
  search?: string;
  page?: number;
}

function buildParams(
  filters: Record<string, string | number | boolean | null | undefined>
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val != null && val !== '') {
      params[key] = val;
    }
  }
  return params;
}

export function useShifts(filters?: ShiftFilters) {
  return useQuery<PaginatedShifts>({
    queryKey: ['shifts', filters],
    queryFn: async () => {
      const params = buildParams({
        is_active: filters?.is_active,
        search: filters?.search,
        page: filters?.page,
      });
      const res = await api.get('/hr/shifts', { params });
      return res.data;
    },
  });
}

export function useShift(id: string) {
  return useQuery<Shift>({
    queryKey: ['shifts', id],
    queryFn: async () => {
      const res = await api.get(`/hr/shifts/${id}`);
      return res.data.data ?? res.data;
    },
    enabled: !!id,
  });
}

export function useCreateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ShiftFormData) => {
      const res = await api.post('/hr/shifts', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift created successfully');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to create shift';
      toast.error(message);
    },
  });
}

export function useUpdateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: ShiftFormData & { id: string }) => {
      const res = await api.put(`/hr/shifts/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift updated successfully');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to update shift';
      toast.error(message);
    },
  });
}

export function useDeleteShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/hr/shifts/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Shift deleted successfully');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to delete shift';
      toast.error(message);
    },
  });
}
