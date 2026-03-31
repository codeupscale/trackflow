import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { LeaveRequestFormData } from '@/lib/validations/leave';

export function useApplyLeave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: LeaveRequestFormData) => {
      // Use FormData if there is a document file
      if (data.document) {
        const formData = new FormData();
        formData.append('leave_type_id', data.leave_type_id);
        formData.append('start_date', data.start_date);
        formData.append('end_date', data.end_date);
        formData.append('reason', data.reason);
        formData.append('half_day', data.half_day ? '1' : '0');
        formData.append('document', data.document);
        return api.post('/hr/leave-requests', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      return api.post('/hr/leave-requests', {
        leave_type_id: data.leave_type_id,
        start_date: data.start_date,
        end_date: data.end_date,
        reason: data.reason,
        half_day: data.half_day,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] });
      queryClient.invalidateQueries({ queryKey: ['leave-calendar'] });
      toast.success('Leave request submitted');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to submit leave request';
      toast.error(message);
    },
  });
}
