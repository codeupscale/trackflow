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

export function useRunPayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => {
      const res = await api.post(`/hr/payroll-periods/${periodId}/run`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      queryClient.invalidateQueries({ queryKey: ['payslips'] });
      toast.success('Payroll run has been queued');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to run payroll');
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
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to approve payroll');
    },
  });
}
