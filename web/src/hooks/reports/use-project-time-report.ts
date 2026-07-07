import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type ProjectTimePeriod = 'week' | 'month' | 'custom';

export interface ProjectTimeFilters {
  project_ids: string[];
  user_id: string | null;
  period: ProjectTimePeriod;
  week_of: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  start_date: string; // YYYY-MM-DD (custom)
  end_date: string; // YYYY-MM-DD (custom)
  page: number;
  per_page: number;
}

export interface ProjectTimeRow {
  id: string;
  user_name: string;
  project_name: string;
  task_name: string | null;
  started_at: string;
  duration_seconds: number;
  activity_score: number;
  billable: boolean;
  billable_amount: number;
}

export interface ProjectTimeSummary {
  total_seconds: number;
  billable_amount: number;
  entry_count: number;
  resource_count: number;
  project_count: number;
}

export interface ProjectTimeResponse {
  data: ProjectTimeRow[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    summary: ProjectTimeSummary;
  };
}

/**
 * Build the `/reports/project-time` query params from the filter state. Shared by the
 * list query and the CSV/PDF export so both request exactly the same slice. Only the
 * date params relevant to the selected period are sent.
 */
export function buildProjectTimeParams(
  filters: Omit<ProjectTimeFilters, 'page' | 'per_page'> & Partial<Pick<ProjectTimeFilters, 'page' | 'per_page'>>
): Record<string, string | number | string[]> {
  const params: Record<string, string | number | string[]> = { period: filters.period };

  if (filters.project_ids.length) params.project_id = filters.project_ids;
  if (filters.user_id) params.user_id = filters.user_id;

  if (filters.period === 'week') {
    params.week_of = filters.week_of;
  } else if (filters.period === 'month') {
    params.month = filters.month;
  } else {
    params.start_date = filters.start_date;
    params.end_date = filters.end_date;
  }

  if (filters.page) params.page = filters.page;
  if (filters.per_page) params.per_page = filters.per_page;

  return params;
}

/** Whether the current filter state has the dates it needs to run a query. */
export function isProjectTimeFilterReady(filters: ProjectTimeFilters): boolean {
  if (filters.period === 'week') return !!filters.week_of;
  if (filters.period === 'month') return !!filters.month;
  return !!filters.start_date && !!filters.end_date;
}

/**
 * Paginated per-entry rows for `/reports/project-time`, plus `meta.summary` over the
 * full filtered set. Gated server-side on `reports.view` and role-scoped (org/team/own).
 * Only runs once `isProjectTimeFilterReady()` is true for the selected period.
 */
export function useProjectTimeReport(filters: ProjectTimeFilters, enabled = true) {
  return useQuery<ProjectTimeResponse>({
    queryKey: ['reports', 'project-time', filters],
    queryFn: async () => {
      const res = await api.get('/reports/project-time', {
        params: buildProjectTimeParams(filters),
      });
      const raw = res.data;
      const meta = raw.meta ?? {};
      return {
        data: raw.data ?? [],
        meta: {
          current_page: meta.current_page ?? 1,
          last_page: meta.last_page ?? 1,
          total: meta.total ?? (raw.data?.length ?? 0),
          summary: {
            total_seconds: meta.summary?.total_seconds ?? 0,
            billable_amount: meta.summary?.billable_amount ?? 0,
            entry_count: meta.summary?.entry_count ?? 0,
            resource_count: meta.summary?.resource_count ?? 0,
            project_count: meta.summary?.project_count ?? 0,
          },
        },
      };
    },
    enabled: enabled && isProjectTimeFilterReady(filters),
    staleTime: 60_000,
  });
}
