import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

export interface SalaryRosterRow {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  /** Null when this employee has no salary — payroll silently skips them. */
  assignment: {
    id: string;
    effective_from: string;
    effective_to: string | null;
    custom_base_salary: number | null;
    /** custom_base_salary when overridden, else the structure's base. */
    effective_base_salary: number;
    structure: { id: string; name: string; type: string; base_salary: number };
  } | null;
}

export interface PaginatedSalaryRoster {
  data: SalaryRosterRow[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

interface RosterParams {
  search?: string;
  status?: 'all' | 'assigned' | 'unassigned';
  page?: number;
  per_page?: number;
}

/**
 * Every active employee and whether they have a salary.
 *
 * Unassigned employees are the reason this exists: runPayroll iterates salary
 * assignments, so someone without one is skipped and the run still reports
 * success. Only a roster driven from the employee list can surface that.
 */
export function useSalaryRoster(params?: RosterParams) {
  return useQuery<PaginatedSalaryRoster>({
    queryKey: ['salary-roster', params],
    queryFn: async () => {
      const query: Record<string, string | number> = {};
      if (params?.search) query.search = params.search;
      if (params?.status && params.status !== 'all') query.status = params.status;
      if (params?.page) query.page = params.page;
      if (params?.per_page) query.per_page = params.per_page;

      const res = await api.get('/hr/salary-roster', { params: query });
      return res.data;
    },
  });
}

export interface AssignSalaryInput {
  employeeId: string;
  salary_structure_id: string;
  custom_base_salary?: number | null;
  effective_from: string;
  effective_to?: string | null;
}

export function useAssignSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ employeeId, ...data }: AssignSalaryInput) => {
      const res = await api.post(`/hr/employees/${employeeId}/salary`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-roster'] });
      // Coverage feeds the payroll readiness card, so it must refresh too.
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      toast.success('Salary assigned');
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as { data?: { message?: string } })?.data?.message ??
        (err as Error)?.message;
      toast.error(message || 'Failed to assign salary');
    },
  });
}
