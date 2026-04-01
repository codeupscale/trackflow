import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { EmployeeNote, EmployeeNoteInput } from '@/lib/validations/employee';
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

interface UseEmployeeNotesParams {
  page?: number;
}

export function useEmployeeNotes(
  employeeId: string | undefined,
  params?: UseEmployeeNotesParams
) {
  return useQuery<PaginatedResponse<EmployeeNote>>({
    queryKey: ['employee-notes', employeeId, params],
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};
      if (params?.page) queryParams.page = params.page;
      const res = await api.get(`/hr/employees/${employeeId}/notes`, {
        params: queryParams,
      });
      return res.data;
    },
    enabled: !!employeeId,
  });
}

export function useCreateNote(employeeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: EmployeeNoteInput) => {
      const res = await api.post(`/hr/employees/${employeeId}/notes`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['employee-notes', employeeId],
      });
      toast.success('Note added');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add note');
    },
  });
}

export function useDeleteNote(employeeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (noteId: string) => {
      const res = await api.delete(
        `/hr/employees/${employeeId}/notes/${noteId}`
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['employee-notes', employeeId],
      });
      toast.success('Note deleted');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete note');
    },
  });
}
