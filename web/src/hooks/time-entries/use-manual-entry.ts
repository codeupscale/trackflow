import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { ManualTimeEntryPayload } from '@/lib/validations/time-entry';

export function useCreateManualEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ManualTimeEntryPayload) => {
      const res = await api.post('/time-entries', payload);
      return res.data as {
        message?: string;
        entry: { approval_status: 'pending' | 'approved' };
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      const pending = data.entry?.approval_status === 'pending';
      toast.success(pending ? 'Submitted for approval' : 'Time entry created');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to create time entry';
      toast.error(message);
    },
  });
}

export function useUpdateManualEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: ManualTimeEntryPayload & { id: string }) => {
      const res = await api.put(`/time-entries/${id}`, payload);
      return res.data as {
        entry?: { approval_status?: 'pending' | 'approved' | 'rejected' };
        approval_reset?: boolean;
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success(data.approval_reset ? 'Updated & resubmitted for approval' : 'Time entry updated');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to update time entry';
      toast.error(message);
    },
  });
}
