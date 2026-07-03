import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { triggerDownload, readBlobError } from '@/lib/download';
import type {
  TodayStatus,
  AttendancePolicy,
  PaginatedAttendance,
  PaginatedCheckInSummary,
} from '@/lib/validations/attendance';
import type { AttendancePolicyFormData } from '@/lib/validations/attendance-policy';

// ─── Filter shapes ────────────────────────────────────────────────

export interface CheckInsListFilters {
  start_date?: string;
  end_date?: string;
  user_id?: string | null;
  status?: string;
  per_page?: number;
  page?: number;
}

export interface CheckInSummaryFilters {
  period?: 'day' | 'month';
  date?: string; // YYYY-MM-DD when period=day
  month?: string; // YYYY-MM when period=month
  user_id?: string | null;
  per_page?: number;
  page?: number;
}

export interface CheckInExportFilters {
  period?: 'day' | 'month';
  date?: string;
  month?: string;
  user_id?: string | null;
  view?: 'detail' | 'summary';
}

function buildParams(
  filters: Record<string, string | number | null | undefined>
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val != null && val !== '' && val !== 'all') {
      params[key] = val;
    }
  }
  return params;
}

// Surface the real server message (409 already checked in, 422 window errors, etc.).
function extractMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (error as { data?: { message?: string } })?.data?.message ??
    (error as { message?: string })?.message ??
    fallback
  );
}

// ─── Today status ─────────────────────────────────────────────────

export function useTodayStatus() {
  return useQuery<TodayStatus>({
    queryKey: ['attendance', 'today'],
    queryFn: async () => {
      const res = await api.get('/hr/attendance/today');
      return res.data.data ?? res.data;
    },
    // Live status — always fresh, and re-sync on focus so the elapsed clock
    // re-anchors to a fresh server_now after tab switches / sleep.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

// ─── Mutations ────────────────────────────────────────────────────

function useInvalidateAfterCheckAction() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['attendance', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['attendance'] });
    // The summary tiles live under a SEPARATE key (['attendance-summary', month,
    // year]); prefix-matching on ['attendance'] does NOT reach it, so it must be
    // invalidated explicitly — otherwise the Present/working-days tiles stay stale
    // (e.g. "0 of 0") until a hard refresh after a check-in.
    queryClient.invalidateQueries({ queryKey: ['attendance-summary'] });
    queryClient.invalidateQueries({ queryKey: ['team-attendance'] });
    queryClient.invalidateQueries({ queryKey: ['check-ins'] });
  };
}

export function useCheckIn() {
  const invalidate = useInvalidateAfterCheckAction();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post('/hr/attendance/check-in');
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Checked in successfully');
    },
    onError: (error: unknown) => {
      toast.error(extractMessage(error, 'Failed to check in'));
    },
  });
}

export function useCheckOut() {
  const invalidate = useInvalidateAfterCheckAction();
  return useMutation({
    mutationFn: async () => {
      const res = await api.post('/hr/attendance/check-out');
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Checked out successfully');
    },
    onError: (error: unknown) => {
      toast.error(extractMessage(error, 'Failed to check out'));
    },
  });
}

// ─── Lists & summary ──────────────────────────────────────────────

export function useCheckInsList(filters?: CheckInsListFilters) {
  return useQuery<PaginatedAttendance>({
    queryKey: ['check-ins', filters],
    queryFn: async () => {
      const params = buildParams({
        start_date: filters?.start_date,
        end_date: filters?.end_date,
        user_id: filters?.user_id,
        status: filters?.status,
        per_page: filters?.per_page,
        page: filters?.page,
      });
      const res = await api.get('/hr/attendance/check-ins', { params });
      return res.data;
    },
  });
}

export function useCheckInsSummary(filters?: CheckInSummaryFilters) {
  return useQuery<PaginatedCheckInSummary>({
    queryKey: ['check-ins', 'summary', filters],
    queryFn: async () => {
      const params = buildParams({
        period: filters?.period,
        date: filters?.date,
        month: filters?.month,
        user_id: filters?.user_id,
        per_page: filters?.per_page,
        page: filters?.page,
      });
      const res = await api.get('/hr/attendance/check-ins/summary', { params });
      return res.data;
    },
  });
}

// ─── Policy ───────────────────────────────────────────────────────

export function useAttendancePolicy() {
  return useQuery<AttendancePolicy>({
    queryKey: ['attendance', 'policy'],
    queryFn: async () => {
      const res = await api.get('/hr/attendance/policy');
      return res.data.data ?? res.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateAttendancePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: AttendancePolicyFormData) => {
      const res = await api.put('/hr/attendance/policy', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'policy'] });
      queryClient.invalidateQueries({ queryKey: ['attendance', 'today'] });
      toast.success('Attendance policy updated');
    },
    onError: (error: unknown) => {
      toast.error(extractMessage(error, 'Failed to update attendance policy'));
    },
  });
}

// ─── Export ───────────────────────────────────────────────────────

/**
 * Download a check-in CSV. Reuses the shared triggerDownload/readBlobError helpers
 * (from the reports export fix) so the same "download never triggers" bug can't
 * reappear here. Returns the resolved filename on success.
 */
export async function exportCheckIns(filters: CheckInExportFilters): Promise<void> {
  const view = filters.view ?? 'detail';
  const period = filters.period ?? 'day';
  const range =
    period === 'month'
      ? filters.month ?? ''
      : filters.date ?? '';

  const params = buildParams({
    period,
    date: filters.date,
    month: filters.month,
    user_id: filters.user_id,
    view,
    format: 'csv',
  });

  try {
    const res = await api.get('/hr/attendance/check-ins/export', {
      params,
      responseType: 'blob',
    });
    const filename = `check-ins-${view}-${period}-${range}.csv`;
    triggerDownload(res.data, filename, 'text/csv');
  } catch (err) {
    toast.error((await readBlobError(err)) ?? 'Failed to export check-in report');
    throw err;
  }
}
