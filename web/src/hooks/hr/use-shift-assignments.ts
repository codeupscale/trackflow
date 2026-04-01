import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import type {
  PaginatedAssignments,
  ShiftAssignmentFormData,
} from '@/lib/validations/shift';

export function useShiftAssignments(shiftId: string) {
  return useQuery<PaginatedAssignments>({
    queryKey: ['shift-assignments', shiftId],
    queryFn: async () => {
      const res = await api.get(`/hr/shifts/${shiftId}/assignments`);
      return res.data;
    },
    enabled: !!shiftId,
  });
}

export function useAssignShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      shiftId,
      ...data
    }: ShiftAssignmentFormData & { shiftId: string }) => {
      const res = await api.post(`/hr/shifts/${shiftId}/assign`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('User assigned to shift successfully');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to assign user to shift';
      toast.error(message);
    },
  });
}

export function useUnassignShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      shiftId,
      userId,
    }: {
      shiftId: string;
      userId: string;
    }) => {
      const res = await api.post(`/hr/shifts/${shiftId}/unassign`, {
        user_id: userId,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('User unassigned from shift');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to unassign user';
      toast.error(message);
    },
  });
}

export function useBulkAssignShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      shiftId,
      user_ids,
      effective_from,
      effective_to,
    }: {
      shiftId: string;
      user_ids: string[];
      effective_from: string;
      effective_to?: string | null;
    }) => {
      const res = await api.post(`/hr/shifts/${shiftId}/bulk-assign`, {
        user_ids,
        effective_from,
        effective_to,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success('Users assigned to shift successfully');
    },
    onError: (error: unknown) => {
      const message =
        (error as { data?: { message?: string } })?.data?.message ??
        (error as { message?: string })?.message ??
        'Failed to bulk assign users';
      toast.error(message);
    },
  });
}
