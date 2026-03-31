import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { LeaveRequest } from '@/lib/validations/leave';

interface LeaveRequestFilters {
  status?: string;
  leave_type_id?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
}

interface PaginatedResponse {
  data: LeaveRequest[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export function useLeaveRequests(filters?: LeaveRequestFilters) {
  return useQuery<PaginatedResponse>({
    queryKey: ['leave-requests', filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters?.status && filters.status !== 'all') params.status = filters.status;
      if (filters?.leave_type_id) params.leave_type_id = filters.leave_type_id;
      if (filters?.start_date) params.start_date = filters.start_date;
      if (filters?.end_date) params.end_date = filters.end_date;
      if (filters?.page) params.page = filters.page;
      const res = await api.get('/hr/leave-requests', { params });
      return res.data;
    },
  });
}
