import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { OvertimeRule, OvertimeRuleFormData } from '@/lib/validations/attendance';

export function useOvertimeRules() {
  return useQuery<OvertimeRule>({
    queryKey: ['overtime-rules'],
    queryFn: async () => {
      const res = await api.get('/hr/overtime-rules');
      return res.data.data ?? res.data;
    },
  });
}

export function useUpdateOvertimeRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: OvertimeRuleFormData) => {
      return api.put('/hr/overtime-rules', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['overtime-rules'] });
      toast.success('Overtime rules updated');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to update overtime rules';
      toast.error(message);
    },
  });
}
