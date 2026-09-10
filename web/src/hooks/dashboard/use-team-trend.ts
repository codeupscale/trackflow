import api from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export type TeamTrendPeriod = "7d" | "30d" | "90d";

export interface TeamTrendPoint {
    date: string;
    /** Axis label: weekday for 7d, "Sep 3" for longer windows. */
    day: string;
    hours: number;
    activity: number;
}

/**
 * Per-day team hours and activity for the admin "Team Trend" chart.
 *
 * Replaces a client-side series that placed every member's today_seconds on
 * today and zero on the other six days — a single number drawn on a week axis,
 * under a period toggle that was wired to nothing.
 */
export function useTeamTrend(period: TeamTrendPeriod, enabled = true) {
    return useQuery<TeamTrendPoint[]>({
        queryKey: ["dashboard-team-trend", period],
        queryFn: async () => {
            const res = await api.get("/dashboard/team-trend", { params: { period } });
            return res.data.data ?? [];
        },
        enabled,
        staleTime: 60_000,
    });
}
