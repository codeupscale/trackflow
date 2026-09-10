import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  PayrollPeriod,
  PayrollPeriodFormData,
  PaginatedResponse,
} from '@/lib/validations/payroll';
import { toast } from 'sonner';

export interface UsePayrollPeriodsParams {
  status?: string;
  page?: number;
  per_page?: number;
}

export function usePayrollPeriods(params?: UsePayrollPeriodsParams) {
  return useQuery<PaginatedResponse<PayrollPeriod>>({
    queryKey: ['payroll-periods', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.per_page) queryParams.per_page = params.per_page;
      if (params?.status) queryParams.status = params.status;
      const res = await api.get('/hr/payroll-periods', { params: queryParams });
      const raw = res.data;
      return {
        data: raw.data ?? [],
        meta: raw.meta ?? {
          current_page: raw.current_page ?? 1,
          last_page: raw.last_page ?? 1,
          per_page: raw.per_page ?? 25,
          total: raw.total ?? 0,
          from: raw.from ?? null,
          to: raw.to ?? null,
        },
      };
    },
  });
}

export function usePayrollPeriod(id: string | undefined) {
  return useQuery<{ data: PayrollPeriod }>({
    queryKey: ['payroll-periods', id],
    queryFn: async () => {
      const res = await api.get(`/hr/payroll-periods/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreatePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: PayrollPeriodFormData) => {
      const res = await api.post('/hr/payroll-periods', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      toast.success('Payroll period created');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create payroll period');
    },
  });
}

export function useUpdatePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<PayrollPeriodFormData> }) => {
      const res = await api.put(`/hr/payroll-periods/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      toast.success('Payroll period updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update payroll period');
    },
  });
}

export function useDeletePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/payroll-periods/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      toast.success('Payroll period deleted');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete payroll period');
    },
  });
}

/**
 * Start a run. The work happens on the queue, so this returns as soon as the
 * job is accepted — it does NOT mean the payslips exist yet.
 *
 * `silent` is for a caller that shows the run's progress itself. "Queued" is a
 * poor thing to be told by a screen that is about to sit and watch the job
 * finish anyway; it reads as the end of the story when it is the start.
 */
export function useRunPayroll(options?: { silent?: boolean }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => {
      const res = await api.post(`/hr/payroll-periods/${periodId}/run`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      if (!options?.silent) toast.success('Payroll run has been queued');
    },
    onError: (err: unknown) => {
      // The server refuses a run when anyone is missing a salary, and names
      // them. That reason must reach the screen: "Failed to run payroll" turns
      // a fixable setup problem into a mystery. Errors arrive wrapped as
      // { error: { message } } — see bootstrap/app.php.
      toast.error(apiErrorMessage(err) ?? (err as Error).message ?? 'Failed to run payroll', {
        duration: 8000,
      });
    },
  });
}

/** The human-readable reason an API call failed, from this API's envelope. */
function apiErrorMessage(err: unknown): string | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (typeof data !== 'object' || data === null) return null;

  const wrapped = (data as { error?: { message?: unknown } }).error?.message;
  if (typeof wrapped === 'string' && wrapped) return wrapped;

  const plain = (data as { message?: unknown }).message;
  return typeof plain === 'string' && plain ? plain : null;
}

/**
 * Close a period once the money has gone out — the final step of the pipeline.
 * The server rejects this with a 422 unless the period is approved, so the
 * message is surfaced rather than a generic failure.
 */
export function useMarkPayrollPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => {
      const res = await api.post(`/hr/payroll-periods/${periodId}/mark-paid`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      toast.success('Payroll marked as paid');
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        (err as { data?: { error?: { message?: string } } })?.data?.error?.message ??
        (err as Error)?.message;
      toast.error(message || 'Failed to mark payroll as paid');
    },
  });
}

export function useApprovePayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => {
      const res = await api.post(`/hr/payroll-periods/${periodId}/approve`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      toast.success('Payroll period approved');
    },
    onError: (err: unknown) => {
      // The server refuses approval with a 422 that NAMES the reason — most
      // often that some payslips have not been verified yet. Reading
      // `err.message` off an axios error gets "Request failed with status code
      // 422" instead, which tells the user a number and nothing they can act
      // on. Same lesson as the run hook above.
      toast.error(apiErrorMessage(err) ?? (err as Error)?.message ?? 'Failed to approve payroll', {
        duration: 8000,
      });
    },
  });
}
