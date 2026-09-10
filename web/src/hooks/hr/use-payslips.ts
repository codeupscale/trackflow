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
  /**
   * Whose payslips: active employees (default), archived ones (true), or
   * everyone in the period ('all'). 'all' exists for a period's detail
   * page, where a run must be reviewed whole or its verified counter
   * disagrees with the approval gate.
   */
  archived?: boolean | 'all';
  /** Calendar year of the payroll PERIOD, not of the row. */
  year?: number;
  /** 1-12, of the payroll PERIOD. Combined with year when both are set. */
  month?: number;
  page?: number;
  per_page?: number;
}

/** Totals over the whole filtered set — the server sums them, never the page. */
export interface PayslipTotals {
  slips: number;
  /** How many are approved or paid, i.e. final rather than still in a run. */
  finalised: number;
  gross: number;
  allowances: number;
  tax: number;
  deductions: number;
  net: number;
}

export interface PayslipListResponse extends PaginatedResponse<Payslip> {
  totals: PayslipTotals;
  /** Years this viewer has payslips in, newest first — drives the picker. */
  years: number[];
}

export function usePayslips(params?: UsePayslipsParams) {
  return useQuery<PayslipListResponse>({
    queryKey: ['payslips', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.per_page) queryParams.per_page = params.per_page;
      if (params?.payroll_period_id) queryParams.payroll_period_id = params.payroll_period_id;
      if (params?.status) queryParams.status = params.status;
      if (params?.user_id) queryParams.user_id = params.user_id;
      if (params?.archived) queryParams.archived = params.archived === 'all' ? 'all' : 1;
      if (params?.year) queryParams.year = params.year;
      if (params?.month) queryParams.month = params.month;
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
        totals: raw.totals ?? {
          slips: 0, finalised: 0, gross: 0, allowances: 0, tax: 0, deductions: 0, net: 0,
        },
        years: raw.years ?? [],
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
