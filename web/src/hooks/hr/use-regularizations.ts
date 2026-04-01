import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { PaginatedRegularizations } from '@/lib/validations/attendance';

interface RegularizationFilters {
  status?: string;
  page?: number;
}

export function useRegularizations(filters?: RegularizationFilters) {
  return useQuery<PaginatedRegularizations>({
    queryKey: ['regularizations', filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters?.status && filters.status !== 'all') {
        params.status = filters.status;
      }
      if (filters?.page) params.page = filters.page;
      const res = await api.get('/hr/attendance/regularizations', { params });
      return res.data;
    },
  });
}

export function useApproveRegularization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.put(`/hr/attendance/regularizations/${id}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regularizations'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['team-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-summary'] });
      toast.success('Regularization approved');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to approve regularization';
      toast.error(message);
    },
  });
}

export function useRejectRegularization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      review_note,
    }: {
      id: string;
      review_note: string;
    }) => {
      return api.put(`/hr/attendance/regularizations/${id}/reject`, {
        review_note,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regularizations'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['team-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-summary'] });
      toast.success('Regularization rejected');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to reject regularization';
      toast.error(message);
    },
  });
}
