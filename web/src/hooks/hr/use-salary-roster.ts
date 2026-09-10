import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';

export interface SalaryRosterRow {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  /** The employee's job, used to offer the grades that belong to it. Null when
   *  no position is set — normal before an org finishes configuring. */
  position: { id: string; title: string } | null;
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
  /**
   * Hold the request until the caller asks for it. The payroll screen starts
   * empty and only fetches the directory when the operator says so, so the
   * query must not fire on mount.
   */
  enabled?: boolean;
}

/**
 * Every active employee and whether they have a salary.
 *
 * Unassigned employees are the reason this exists: runPayroll iterates salary
 * assignments, so someone without one is skipped and the run still reports
 * success. Only a roster driven from the employee list can surface that.
 */
export interface BulkAssignPayload {
  user_ids: string[];
  salary_structure_id: string;
  custom_base_salary?: number | null;
  effective_from: string;
  effective_to?: string | null;
}

/**
 * Assign one structure to many employees at once.
 *
 * Server-side this is a single transaction — a half-applied bulk assign would
 * leave exactly the state it exists to prevent: some people covered, some
 * silently skipped by the next run.
 */
export function useBulkAssignSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: BulkAssignPayload) => {
      const res = await api.post('/hr/salary-roster/bulk-assign', payload);
      return res.data as { message: string; data: { assigned: number } };
    },
    // Deliberately silent on success. Assigning a roster is ONE action to the
    // person doing it, but it is sent as a batch per salary grade — so a toast
    // here produced a stack of them, one per grade, for a single press. The
    // caller reports the outcome once, over the whole run. Failures still
    // announce themselves here: the loop stops on the first one, so there is
    // only ever one, and it must not wait for a summary that never comes.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-roster'] });
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
      queryClient.invalidateQueries({ queryKey: ['employee-salary'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: unknown } })?.response?.data;
      const wrapped =
        typeof data === 'object' && data !== null
          ? ((data as { error?: { message?: string } }).error?.message ??
            (data as { message?: string }).message)
          : null;
      toast.error(wrapped || 'Failed to assign salaries');
    },
  });
}

const ROSTER_FETCHED_KEY = 'trackflow:payroll-roster-fetched';

/**
 * Whether the employee directory has already been fetched on the payroll
 * screen — remembered for the browser tab, and only for as long as it is still
 * TRUE of the server.
 *
 * Two things pulled against each other here. Fetching is a step performed once,
 * so it has to survive switching tabs and leaving the page: keeping it in
 * component state meant every return threw it away and asked again. But a run
 * RESET on the server genuinely returns the operator to step one, and a flag
 * that outlives the run it describes offers "Assign salaries" for a run that
 * no longer exists.
 *
 * The fix is to store WHAT the fetch was made against, not merely that it
 * happened. `stateKey` is the payroll period's own updated_at: a reset touches
 * the period, so the key moves and the flag is dropped; fetching and assigning
 * do not touch it, so the flag holds for the whole middle of the flow.
 *
 * Read after mount, never during render: touching sessionStorage while
 * rendering makes the server and client disagree and React discards the tree.
 */
export function useRosterFetched(stateKey?: string | null): [boolean, () => void] {
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    // Until the period has loaded there is nothing to compare against, and
    // clearing on an unknown key would drop a good flag on every page load.
    if (!stateKey) return;

    let matches = false;
    try {
      const stored = sessionStorage.getItem(ROSTER_FETCHED_KEY);
      matches = stored === stateKey;
      // Stale: made against a run that has since been reset or re-run.
      if (!matches && stored !== null) sessionStorage.removeItem(ROSTER_FETCHED_KEY);
    } catch {
      // Private mode, or storage disabled. Falling back to "not fetched" costs
      // one press and is never wrong in a way that loses data.
    }

    // sessionStorage cannot be read during render: the server has no such
    // value, so rendering from it would make the two markups disagree and
    // React would throw the tree away. Reading after mount is the supported
    // way to adopt browser-only state, and this settles in one pass per key.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFetched(matches);
  }, [stateKey]);

  const markFetched = useCallback(() => {
    setFetched(true);
    try {
      if (stateKey) sessionStorage.setItem(ROSTER_FETCHED_KEY, stateKey);
    } catch {
      /* see above */
    }
  }, [stateKey]);

  return [fetched, markFetched];
}

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
    enabled: params?.enabled ?? true,
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
      // The employee modal reads this person's assignment on its own key —
      // without this the tab you just assigned from keeps showing "no salary".
      queryClient.invalidateQueries({ queryKey: ['employee-salary'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
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
