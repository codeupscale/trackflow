import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  Payslip,
  PaginatedResponse,
} from '@/lib/validations/payroll';

export interface UsePayslipsParams {
  payroll_period_id?: string;
  status?: string;
  user_id?: string;
  page?: number;
  per_page?: number;
}

export function usePayslips(params?: UsePayslipsParams) {
  return useQuery<PaginatedResponse<Payslip>>({
    queryKey: ['payslips', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.per_page) queryParams.per_page = params.per_page;
      if (params?.payroll_period_id) queryParams.payroll_period_id = params.payroll_period_id;
      if (params?.status) queryParams.status = params.status;
      if (params?.user_id) queryParams.user_id = params.user_id;
      const res = await api.get('/hr/payslips', { params: queryParams });
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

export function usePayslip(id: string | undefined) {
  return useQuery<{ data: Payslip }>({
    queryKey: ['payslips', id],
    queryFn: async () => {
      const res = await api.get(`/hr/payslips/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}
