import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { LeaveCalendarDay, PublicHoliday } from '@/lib/validations/leave';

interface LeaveCalendarResponse {
  days: LeaveCalendarDay[];
  holidays: PublicHoliday[];
}

export function useLeaveCalendar(month: number, year: number) {
  return useQuery<LeaveCalendarResponse>({
    queryKey: ['leave-calendar', month, year],
    queryFn: async () => {
      const res = await api.get('/hr/leave-calendar', {
        params: { month, year },
      });
      return res.data.data ?? res.data;
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
