import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Position, PositionInput } from '@/lib/validations/position';
import { toast } from 'sonner';

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    from: number | null;
    to: number | null;
  };
}

interface UsePositionsParams {
  department_id?: string;
  level?: string;
  page?: number;
}

export function usePositions(params?: UsePositionsParams) {
  return useQuery<PaginatedResponse<Position>>({
    queryKey: ['positions', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.department_id)
        queryParams.department_id = params.department_id;
      if (params?.level) queryParams.level = params.level;
      const res = await api.get('/hr/positions', { params: queryParams });
      return res.data;
    },
  });
}

export function useCreatePosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: PositionInput) => {
      const res = await api.post('/hr/positions', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      toast.success('Position created successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create position');
    },
  });
}

export function useUpdatePosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: PositionInput & { id: string }) => {
      const res = await api.put(`/hr/positions/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      toast.success('Position updated successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update position');
    },
  });
}

export function useArchivePosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/hr/positions/${id}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      toast.success('Position archived successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to archive position');
    },
  });
}
