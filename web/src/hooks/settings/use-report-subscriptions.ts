import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

export interface ReportSubscription {
  id: string;
  report_type: string;
  is_active: boolean;
  day_of_week: number;
  send_time: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

interface ReportSubscriptionInput {
  report_type: string;
  is_active: boolean;
  day_of_week: number;
  send_time: string;
  timezone: string;
}

interface PaginatedSubscriptions {
  data: ReportSubscription[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
  };
}

export function useReportSubscriptions() {
  return useQuery<PaginatedSubscriptions>({
    queryKey: ['report-subscriptions'],
    queryFn: async () => {
      const res = await api.get('/report-subscriptions');
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpsertReportSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ReportSubscriptionInput) => {
      const res = await api.post('/report-subscriptions', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-subscriptions'] });
      toast.success('Email report settings saved');
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to save email report settings';
      toast.error(message);
    },
  });
}

export function useDeleteReportSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/report-subscriptions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-subscriptions'] });
      toast.success('Report subscription removed');
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to delete subscription';
      toast.error(message);
    },
  });
}
