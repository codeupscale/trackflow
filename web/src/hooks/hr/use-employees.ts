import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type {
  EmployeeListItem,
  EmployeeDetail,
  EmployeeProfileInput,
} from '@/lib/validations/employee';
import { toast } from 'sonner';

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
  };
}

export interface UseEmployeesParams {
  search?: string;
  department_id?: string;
  employment_status?: string;
  employment_type?: string;
  page?: number;
  per_page?: number;
}

export function useEmployees(params?: UseEmployeesParams) {
  return useQuery<PaginatedResponse<EmployeeListItem>>({
    queryKey: ['employees', params],
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};
      if (params?.page) queryParams.page = params.page;
      if (params?.per_page) queryParams.per_page = params.per_page;
      if (params?.search) queryParams.search = params.search;
      if (params?.department_id) queryParams.department_id = params.department_id;
      if (params?.employment_status && params.employment_status !== 'all')
        queryParams.employment_status = params.employment_status;
      if (params?.employment_type && params.employment_type !== 'all')
        queryParams.employment_type = params.employment_type;
      const res = await api.get('/hr/employees', { params: queryParams });
      const raw = res.data;
      // Laravel returns flat pagination; normalize to {data, meta} format
      return {
        data: raw.data ?? [],
        meta: raw.meta ?? {
          current_page: raw.current_page ?? 1,
          last_page: raw.last_page ?? 1,
          per_page: raw.per_page ?? 25,
          total: raw.total ?? 0,
          from: raw.from ?? null,
          to: raw.to ?? null,
        },
      };
    },
  });
}

export function useEmployee(id: string | undefined) {
  return useQuery<{ data: EmployeeDetail }>({
    queryKey: ['employees', id],
    queryFn: async () => {
      const res = await api.get(`/hr/employees/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useUpdateEmployeeProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: EmployeeProfileInput;
    }) => {
      const res = await api.put(`/hr/employees/${id}/profile`, data);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees', variables.id] });
      toast.success('Profile updated successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update profile');
    },
  });
}
