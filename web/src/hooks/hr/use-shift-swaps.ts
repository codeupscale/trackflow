import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { PaginatedSwaps, ShiftSwapFormData } from '@/lib/validations/shift';

interface SwapFilters {
  status?: string;
  page?: number;
}

export function useShiftSwaps(filters?: SwapFilters) {
  return useQuery<PaginatedSwaps>({
    queryKey: ['shift-swaps', filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters?.status && filters.status !== 'all') {
        params.status = filters.status;
      }
      if (filters?.page) params.page = filters.page;
      const res = await api.get('/hr/shift-swaps', { params });
      return res.data;
    },
  });
}

export function useCreateShiftSwap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ShiftSwapFormData) => {
      const res = await api.post('/hr/shift-swaps', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-swaps'] });
      toast.success('Shift swap request submitted');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to submit swap request';
      toast.error(message);
    },
  });
}

export function useApproveSwap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.put(`/hr/shift-swaps/${id}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-swaps'] });
      queryClient.invalidateQueries({ queryKey: ['shift-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['shift-roster'] });
      toast.success('Swap request approved');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to approve swap request';
      toast.error(message);
    },
  });
}

export function useRejectSwap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      reviewer_note,
    }: {
      id: string;
      reviewer_note: string;
    }) => {
      return api.put(`/hr/shift-swaps/${id}/reject`, { reviewer_note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-swaps'] });
      toast.success('Swap request rejected');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to reject swap request';
      toast.error(message);
    },
  });
}

export function useCancelSwap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/hr/shift-swaps/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-swaps'] });
      toast.success('Swap request cancelled');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to cancel swap request';
      toast.error(message);
    },
  });
}
