import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { LeaveType } from '@/lib/validations/leave';

export function useLeaveTypes() {
  return useQuery<LeaveType[]>({
    queryKey: ['leave-types'],
    queryFn: async () => {
      const res = await api.get('/hr/leave-types');
      return res.data.data ?? res.data;
    },
  });
}
