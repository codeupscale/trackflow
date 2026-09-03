import api from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

/**
 * "My hours by project" for one period.
 *
 * Always self-scoped server-side — there is no user_id to pass — so this works
 * for every role, including an employee who holds no reports permission.
 */
export type ProjectHoursPeriod = "today" | "week" | "month" | "custom";

export interface ProjectHoursFilters {
    period: ProjectHoursPeriod;
    /** YYYY-MM, used when period is "month". */
    month: string;
    /** YYYY-MM-DD, any date inside the wanted week. */
    week_of: string;
    /** YYYY-MM-DD, used when period is "custom". */
    start_date: string;
    end_date: string;
    /** Narrow to one project; ANDs with the period. */
    project_id: string | null;
}

export interface ProjectHoursRow {
    project_id: string | null;
    name: string;
    color: string | null;
    entry_count: number;
    total_seconds: number;
}

export interface ProjectHoursResponse {
    period: ProjectHoursPeriod;
    date_from: string;
    date_to: string;
    total_seconds: number;
    projects: ProjectHoursRow[];
}

/**
 * Only the parameters the chosen period actually uses are sent. Passing all of
 * them would put a stale `month` in the query key of a "custom" request and
 * refetch on changes that cannot affect the answer.
 */
export function buildProjectHoursParams(
    filters: ProjectHoursFilters,
): Record<string, string> {
    const params: Record<string, string> = { period: filters.period };

    if (filters.period === "month") params.month = filters.month;
    if (filters.period === "week") params.week_of = filters.week_of;
    if (filters.period === "custom") {
        params.start_date = filters.start_date;
        params.end_date = filters.end_date;
    }
    if (filters.project_id) params.project_id = filters.project_id;

    return params;
}

export function useProjectHours(filters: ProjectHoursFilters) {
    const params = buildProjectHoursParams(filters);

    return useQuery<ProjectHoursResponse>({
        queryKey: ["dashboard-project-hours", params],
        queryFn: async () => {
            const res = await api.get("/dashboard/project-hours", { params });
            return res.data;
        },
        staleTime: 60_000,
    });
}
