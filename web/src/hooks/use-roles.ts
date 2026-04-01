import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  is_default: boolean;
  priority: number;
  users_count: number;
}

export interface PermissionDetail {
  id: string;
  key: string;
  action: string;
  description: string;
  has_scope: boolean;
  scope: string | null;
}

export interface RoleWithPermissions extends Role {
  permissions: Record<string, PermissionDetail[]>;
}

export interface PermissionDefinition {
  id: string;
  key: string;
  action: string;
  description: string;
  has_scope: boolean;
}

export type PermissionsByModule = Record<string, PermissionDefinition[]>;

interface CreateRoleInput {
  display_name: string;
  description?: string;
  permissions: Record<string, string>;
}

interface UpdateRoleInput {
  id: string;
  display_name?: string;
  description?: string | null;
  permissions: Record<string, string>;
}

interface AssignRoleInput {
  userId: string;
  role_id: string;
}

// ── Queries ──────────────────────────────────────────────────────────────

export function useRoles() {
  return useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await api.get('/roles');
      return res.data.data;
    },
    staleTime: 60_000,
  });
}

export function useRole(id: string | null) {
  return useQuery<RoleWithPermissions>({
    queryKey: ['roles', id],
    queryFn: async () => {
      const res = await api.get(`/roles/${id}`);
      return res.data.data;
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function usePermissionsList() {
  return useQuery<PermissionsByModule>({
    queryKey: ['permissions-list'],
    queryFn: async () => {
      const res = await api.get('/permissions');
      return res.data.data;
    },
    staleTime: 5 * 60_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────

export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateRoleInput) => {
      const res = await api.post('/roles', data);
      return res.data.data as RoleWithPermissions;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role created successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create role');
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateRoleInput) => {
      const res = await api.put(`/roles/${id}`, data);
      return res.data.data as RoleWithPermissions;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['roles', variables.id] });
      toast.success('Role updated successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update role');
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted successfully');
    },
    onError: (err: Error & { data?: { users_count?: number } }) => {
      toast.error(err.message || 'Failed to delete role');
    },
  });
}

export function useAssignRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, role_id }: AssignRoleInput) => {
      const res = await api.put(`/users/${userId}/role`, { role_id });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Role assigned successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to assign role');
    },
  });
}
