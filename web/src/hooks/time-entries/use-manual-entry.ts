import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { ManualTimeEntryPayload } from '@/lib/validations/time-entry';

/**
 * Create a manual time entry (`POST /time-entries`).
 *
 * Employees self-submit → the entry lands `pending` and needs approval.
 * Managers (self or on-behalf) → the entry is `approved` immediately. The success
 * toast reflects whichever state the server returns. On success we invalidate the
 * time-entry lists AND the reports caches so approved entries surface everywhere.
 */
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
