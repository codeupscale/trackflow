import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import api from '@/lib/api';
import type { LeaveBalance } from '@/lib/validations/leave';

export function useLeaveBalance(userId?: string) {
  const query = useQuery<LeaveBalance[]>({
    queryKey: ['leave-balance', userId],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (userId) params.user_id = userId;
      const res = await api.get('/hr/leave-balances', { params });
      // API returns {balances: [...]} or {data: [...]} or plain array
      const raw = res.data;
      return raw.balances ?? raw.data ?? (Array.isArray(raw) ? raw : []);
    },
  });

  const getBalance = useCallback(
    (typeCode: string): LeaveBalance | undefined => {
      return query.data?.find((b) => b.leave_type.code === typeCode);
    },
    [query.data]
  );

  return {
    balances: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    getBalance,
  };
}
