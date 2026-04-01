import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { LeaveCalendarEntry, PublicHoliday } from '@/lib/validations/leave';

interface LeaveCalendarResponse {
  calendar: Record<string, LeaveCalendarEntry[]>;
  holidays: PublicHoliday[];
}

export function useLeaveCalendar(month: number, year: number) {
  return useQuery<LeaveCalendarResponse>({
    queryKey: ['leave-calendar', month, year],
    queryFn: async () => {
      const raw = await api.get('/hr/leave-calendar', {
        params: { month, year },
      });
      const data = raw.data.data ?? raw.data;
      return {
        calendar: data.calendar ?? {},
        holidays: data.holidays ?? [],
      };
    },
  });
}

export function usePublicHolidays() {
  return useQuery<PublicHoliday[]>({
    queryKey: ['public-holidays'],
    queryFn: async () => {
      const res = await api.get('/hr/public-holidays');
      return res.data.data ?? res.data;
    },
  });
}
