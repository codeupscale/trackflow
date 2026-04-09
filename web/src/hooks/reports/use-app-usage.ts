import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface AppUsageEntry {
  app_name: string;
  duration_seconds: number;
  is_productive: boolean | null;
  window_title: string;
}

interface PaginatedAppUsage {
  data: AppUsageEntry[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
  };
}

export interface TeamAppUsageEntry {
  user_id: string;
  user_name: string;
  app_name: string;
  duration_seconds: number;
  is_productive: boolean | null;
}

interface TeamAppUsageResponse {
  data: TeamAppUsageEntry[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
  };
}

export interface TopAppEntry {
  app_name: string;
  duration_seconds: number;
  is_productive: boolean | null;
}

interface TopAppsResponse {
  data: TopAppEntry[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
  };
}

export function useMyAppUsage(date: string) {
  return useQuery<PaginatedAppUsage>({
    queryKey: ['app-usage', 'daily', date],
    queryFn: async () => {
      const res = await api.get('/app-usage/daily', {
        params: { date },
      });
      return res.data;
    },
    enabled: !!date,
    staleTime: 60_000,
  });
}

export function useTeamAppUsage(startDate: string, endDate: string) {
  return useQuery<TeamAppUsageResponse>({
    queryKey: ['app-usage', 'team', startDate, endDate],
    queryFn: async () => {
      const res = await api.get('/app-usage/team', {
        params: { start_date: startDate, end_date: endDate },
      });
      return res.data;
    },
    enabled: !!startDate && !!endDate,
    staleTime: 60_000,
  });
}

export function useTopApps(startDate: string, endDate: string, limit: number = 10) {
  return useQuery<TopAppsResponse>({
    queryKey: ['app-usage', 'top', startDate, endDate, limit],
    queryFn: async () => {
      const res = await api.get('/app-usage/top', {
        params: { start_date: startDate, end_date: endDate, limit },
      });
      return res.data;
    },
    enabled: !!startDate && !!endDate,
    staleTime: 60_000,
  });
}
