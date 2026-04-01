import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type {
  PaginatedAttendance,
  AttendanceSummary,
  RegularizationFormData,
} from '@/lib/validations/attendance';

interface AttendanceFilters {
  start_date?: string;
  end_date?: string;
  status?: string;
  page?: number;
}

interface TeamAttendanceFilters {
  department_id?: string | null;
  user_id?: string | null;
  start_date?: string;
  end_date?: string;
  page?: number;
}

function buildParams(filters: Record<string, string | number | null | undefined>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val != null && val !== '' && val !== 'all') {
      params[key] = val;
    }
  }
  return params;
}

export function useAttendance(filters?: AttendanceFilters) {
  return useQuery<PaginatedAttendance>({
    queryKey: ['attendance', filters],
    queryFn: async () => {
      const params = buildParams({
        start_date: filters?.start_date,
        end_date: filters?.end_date,
        status: filters?.status,
        page: filters?.page,
      });
      const res = await api.get('/hr/attendance', { params });
      return res.data;
    },
  });
}

export function useTeamAttendance(filters?: TeamAttendanceFilters) {
  return useQuery<PaginatedAttendance>({
    queryKey: ['team-attendance', filters],
    queryFn: async () => {
      const params = buildParams({
        department_id: filters?.department_id,
        user_id: filters?.user_id,
        start_date: filters?.start_date,
        end_date: filters?.end_date,
        page: filters?.page,
      });
      const res = await api.get('/hr/attendance/team', { params });
      return res.data;
    },
  });
}

export function useAttendanceSummary(month: number, year: number) {
  return useQuery<AttendanceSummary>({
    queryKey: ['attendance-summary', month, year],
    queryFn: async () => {
      const res = await api.get('/hr/attendance/summary', {
        params: { month, year },
      });
      return res.data.data ?? res.data;
    },
  });
}

export function useRequestRegularization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: RegularizationFormData) => {
      return api.post(
        `/hr/attendance/${data.attendance_record_id}/regularize`,
        {
          requested_status: data.requested_status,
          reason: data.reason,
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-summary'] });
      queryClient.invalidateQueries({ queryKey: ['regularizations'] });
      toast.success('Regularization request submitted');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to submit regularization request';
      toast.error(message);
    },
  });
}

export function useGenerateAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return api.post('/hr/attendance/generate');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['team-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-summary'] });
      toast.success('Attendance generation triggered');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to generate attendance';
      toast.error(message);
    },
  });
}
