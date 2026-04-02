import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { ShiftRoster } from '@/lib/validations/shift';

export function useShiftRoster(weekStart: string) {
  return useQuery<ShiftRoster>({
    queryKey: ['shift-roster', weekStart],
    queryFn: async () => {
      const res = await api.get('/hr/shifts/roster', {
        params: { week_start: weekStart },
      });
      return res.data.data ?? res.data;
    },
    enabled: !!weekStart,
  });
}
