import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { PendingTimeEntry } from '@/lib/validations/time-entry';

export interface PendingApprovalFilters {
  user_id?: string | null;
  project_id?: string | null;
  page?: number;
  per_page?: number;
}

export interface PendingApprovalsResponse {
  data: PendingTimeEntry[];
  current_page: number;
  last_page: number;
  total: number;
}

/**
 * Managers-only: paginated queue of pending manual entries awaiting approval
 * (`GET /time-entries/pending`). The endpoint is gated on `time_entries.approve`
 * and row-scoped server-side (own team vs whole org).
 */
export function usePendingApprovals(filters: PendingApprovalFilters = {}, enabled = true) {
  return useQuery<PendingApprovalsResponse>({
    enabled,
    queryKey: ['time-entries', 'pending', filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters.user_id) params.user_id = filters.user_id;
      if (filters.project_id) params.project_id = filters.project_id;
      if (filters.page) params.page = filters.page;
      params.per_page = filters.per_page ?? 20;
      const res = await api.get('/time-entries/pending', { params });
      const raw = res.data;
      // Laravel paginator: fields may sit at top level or under `meta`.
      const meta = raw.meta ?? raw;
      return {
        data: raw.data ?? [],
        current_page: meta.current_page ?? 1,
        last_page: meta.last_page ?? 1,
        total: meta.total ?? (raw.data?.length ?? 0),
      };
    },
    staleTime: 30_000,
  });
}

/** Approve a pending entry (`POST /time-entries/{id}/approve`). */
export function useApproveTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/time-entries/${id}/approve`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Time entry approved');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to approve time entry';
      toast.error(message);
    },
  });
}

/** Reject a pending entry with a reason (`POST /time-entries/{id}/reject`). */
export function useRejectTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, rejection_reason }: { id: string; rejection_reason: string }) => {
      const res = await api.post(`/time-entries/${id}/reject`, { rejection_reason });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success('Time entry rejected');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to reject time entry';
      toast.error(message);
    },
  });
}
