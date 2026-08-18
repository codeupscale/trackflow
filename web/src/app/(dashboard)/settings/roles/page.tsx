'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Info,
  Crown,
  Users,
  Lock,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

import { cn } from '@/lib/utils';
import { usePermissionStore } from '@/stores/permission-store';
import {
  useRoles,
  useRole,
  usePermissionsList,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
} from '@/hooks/use-roles';
import type {
  Role,
  PermissionDetail,
  PermissionDefinition,
} from '@/hooks/use-roles';

// ── Constants ────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  time_entries: 'Time Entries',
  screenshots: 'Screenshots',
  projects: 'Projects',
  reports: 'Reports & Analytics',
  departments: 'Departments',
  positions: 'Positions',
  employees: 'Employees',
  leave: 'Leave Management',
  attendance: 'Attendance',
  team: 'Team Management',
  settings: 'Settings',
  roles: 'Roles & Permissions',
  audit_logs: 'Audit Logs',
};

const SCOPE_OPTIONS = [
  { value: '', label: 'Disabled' },
  { value: 'own', label: 'Own' },
  { value: 'project', label: 'Project' },
  { value: 'organization', label: 'Organization' },
];

function getModuleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a lookup from the role's granted permissions (array per module)
 * to a flat map of permission_key -> granted_scope.
 */
function buildGrantedMap(
  permissions: Record<string, PermissionDetail[]> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!permissions) return map;
  for (const perms of Object.values(permissions)) {
    for (const p of perms) {
      map[p.key] = p.scope ?? '';
    }
  }
  return map;
}

// ── Page Component ───────────────────────────────────────────────────────

export default function RolesPage() {
  const { hasPermission } = usePermissionStore();

  const { data: roles, isLoading: rolesLoading, isError: rolesError } = useRoles();
  const { data: permissionsList, isLoading: permsLoading } = usePermissionsList();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const { data: roleDetail, isLoading: roleDetailLoading } = useRole(selectedRoleId);

  const createMutation = useCreateRole();
  const updateMutation = useUpdateRole();
  const deleteMutation = useDeleteRole();

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  // Local permission edits: permission_key -> scope ('' = disabled)
  const [editedPermissions, setEditedPermissions] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Collapsible module sections
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const selectedRole = useMemo(
    () => roles?.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const isOwnerRole = selectedRole?.priority !== undefined && selectedRole.priority >= 100;
  const canEdit = hasPermission('roles.edit') && !isOwnerRole;

  // Initialize edits when role detail loads
  const initEdits = useCallback(
    (detail: typeof roleDetail) => {
      if (!detail || !permissionsList) return;
      const granted = buildGrantedMap(detail.permissions);
      const edits: Record<string, string> = {};
      for (const perms of Object.values(permissionsList)) {
        for (const p of perms) {
          edits[p.key] = granted[p.key] ?? '';
        }
      }
      setEditedPermissions(edits);
      setHasChanges(false);
    },
    [permissionsList],
  );

  // Reset edits when selecting a new role
  const handleSelectRole = useCallback(
    (role: Role) => {
      if (role.priority >= 100) {
        // Owner role: select for display but no editing
        setSelectedRoleId(role.id);
        setEditedPermissions({});
        setHasChanges(false);
        return;
      }
      setSelectedRoleId(role.id);
    },
    [],
  );

  // When roleDetail loads, initialize edits
  useMemo(() => {
    if (roleDetail && roleDetail.id === selectedRoleId) {
      initEdits(roleDetail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleDetail, selectedRoleId]);

  const handlePermissionChange = (key: string, value: string) => {
    setEditedPermissions((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!selectedRoleId) return;
    // Only include granted permissions in the payload.
    // Revoked permissions (empty scope) are omitted — the backend detaches all
    // permissions first, so any key absent from the payload is effectively revoked.
    const permissions: Record<string, string> = {};
    console.log("editedPermissions",editedPermissions)
    for (const [key, scope] of Object.entries(editedPermissions)) {
      if (scope) {
        permissions[key] = scope;
      }
    }
    updateMutation.mutate(
      { id: selectedRoleId, permissions },
      {
        onSuccess: () => {
          setHasChanges(false);
        },
      },
    );
  };

  const handleCancel = () => {
    if (roleDetail) {
      initEdits(roleDetail);
    }
  };

  const handleCreate = () => {
    if (!createName.trim()) return;
    // Create with all permissions disabled by default.
    // has_scope=false permissions are represented by 'none' when granted;
    // has_scope=true permissions must never use 'none' — omit them (no row = disabled).

    createMutation.mutate(
      {
        display_name: createName.trim(),
        description: createDescription.trim() || undefined,
        permissions: {},
      },
      {
        onSuccess: (data) => {
          setCreateOpen(false);
          setCreateName('');
          setCreateDescription('');
          setSelectedRoleId(data.id);
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    // Clear selection immediately so useRole doesn't refetch a deleted resource
    if (selectedRoleId === deleteTarget.id) {
      setSelectedRoleId(null);
      setEditedPermissions({});
      setHasChanges(false);
    }
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        setDeleteTarget(null);
      },
    });
  };

  const toggleModule = (module: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) {
        next.delete(module);
      } else {
        next.add(module);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (permissionsList) {
      setExpandedModules(new Set(Object.keys(permissionsList)));
    }
  };

  const collapseAll = () => {
    setExpandedModules(new Set());
  };

  // ── Derived stats ─────────────────────────────────────────────────────

  const totalRoles = roles?.length ?? 0;
  const systemRoles = roles?.filter((r) => r.is_system).length ?? 0;
  const customRoles = roles?.filter((r) => !r.is_system).length ?? 0;
  const totalUsers = roles?.reduce((sum, r) => sum + (r.users_count ?? 0), 0) ?? 0;

  // ── Access check ───────────────────────────────────────────────────────

  if (!hasPermission('roles.view')) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <Shield className="h-8 w-8 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">You do not have access to view roles.</p>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────

  if (rolesLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Skeleton className="h-5 w-48 mb-1.5" />
          <Skeleton className="h-3 w-72" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-lg" />
          ))}
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-52 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────

  if (rolesError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <Shield className="h-5 w-5 text-destructive" />
          </div>
          <p className="text-xs text-destructive font-medium">Failed to load roles</p>
          <Button
            variant="outline"
            className="h-8 text-xs"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sortedRoles = [...(roles ?? [])].sort((a, b) => b.priority - a.priority);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Roles & Permissions</h1>
          <p className="text-xs text-muted-foreground">
            Manage roles and configure what each role can access
          </p>
        </div>
        {hasPermission('roles.create') && (
          <Button className="h-8 text-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Create Custom Role
          </Button>
        )}
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <Shield className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Total Roles</p>
                <p className="text-base font-bold tabular-nums leading-tight">{totalRoles}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                <Lock className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">System</p>
                <p className="text-base font-bold tabular-nums leading-tight">{systemRoles}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                <Layers className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Custom</p>
                <p className="text-base font-bold tabular-nums leading-tight">{customRoles}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                <Users className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Assigned Users</p>
                <p className="text-base font-bold tabular-nums leading-tight">{totalUsers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role Cards */}
      <ScrollArea className="w-full">
        <div className="flex gap-3 pb-3">
          {sortedRoles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              isSelected={selectedRoleId === role.id}
              onSelect={() => handleSelectRole(role)}
              onDelete={
                hasPermission('roles.delete') && !role.is_system
                  ? () => {
                      setDeleteTarget(role);
                      setDeleteOpen(true);
                    }
                  : undefined
              }
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Permission Matrix */}
      {selectedRoleId && (
        <Card>
          <div className="px-4 pt-3 pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
                  <Shield className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">
                    {isOwnerRole ? 'Viewing' : 'Editing'}: {selectedRole?.display_name}
                  </h3>
                  <p className="text-[0.65rem] text-muted-foreground">
                    {isOwnerRole
                      ? 'Owner has full access to all features'
                      : selectedRole?.is_system
                        ? 'System role — permissions can be customized'
                        : 'Custom role — fully configurable'}
                  </p>
                </div>
              </div>
              {!isOwnerRole && (
                <div className="flex gap-2">
                  <Button variant="outline" className="h-8 text-xs" onClick={expandAll}>
                    Expand All
                  </Button>
                  <Button variant="outline" className="h-8 text-xs" onClick={collapseAll}>
                    Collapse All
                  </Button>
                </div>
              )}
            </div>
          </div>
          <CardContent className="pt-0">
            {isOwnerRole ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-2.5">
                <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Full Access</p>
                  <p className="text-[0.65rem] text-muted-foreground">
                    The Owner role has unrestricted access to all features and modules.
                    Permissions cannot be modified.
                  </p>
                </div>
              </div>
            ) : roleDetailLoading || permsLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : permissionsList ? (
              <div className="flex flex-col gap-1.5">
                {Object.entries(permissionsList).map(([module, perms]) => (
                  <ModuleSection
                    key={module}
                    module={module}
                    permissions={perms}
                    editedPermissions={editedPermissions}
                    isExpanded={expandedModules.has(module)}
                    onToggle={() => toggleModule(module)}
                    onPermissionChange={handlePermissionChange}
                    disabled={!canEdit}
                  />
                ))}

                {/* Save / Cancel buttons */}
                {canEdit && (
                  <>
                    <div className="border-t border-border/40 my-3" />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={handleCancel}
                        disabled={!hasChanges || updateMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="h-8 text-xs"
                        onClick={handleSave}
                        disabled={!hasChanges || updateMutation.isPending}
                      >
                        {updateMutation.isPending && (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        )}
                        Save Changes
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Empty state when no role selected */}
      {!selectedRoleId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Shield className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">Select a role to view permissions</p>
            <p className="text-[0.65rem] text-muted-foreground">
              Click on any role card above to view or edit its permissions
            </p>
          </CardContent>
        </Card>
      )}

      {/* Create Role Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
                <Plus className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <DialogTitle className="text-base">Create Custom Role</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Create a new role with custom permissions. All permissions start disabled.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-name" className="text-xs">
                Display Name
              </Label>
              <Input
                id="role-name"
                placeholder="e.g. HR Manager, Project Lead"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role-desc" className="text-xs">
                Description
              </Label>
              <Textarea
                id="role-desc"
                placeholder="What is this role responsible for?"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                className="text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              className="h-8 text-xs"
              onClick={handleCreate}
              disabled={!createName.trim() || createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              )}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </div>
              <DialogTitle className="text-base">Delete Role</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              {deleteTarget && deleteTarget.users_count > 0
                ? `This role has ${deleteTarget.users_count} user(s) assigned. Please reassign them before deleting.`
                : `Are you sure you want to delete the "${deleteTarget?.display_name}" role? This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-8 text-xs"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteTarget(null);
              }}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            {deleteTarget && deleteTarget.users_count === 0 && (
              <Button
                variant="destructive"
                className="h-8 text-xs"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                )}
                Delete Role
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Role Card Component ──────────────────────────────────────────────────

function RoleCard({
  role,
  isSelected,
  onSelect,
  onDelete,
}: {
  role: Role;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const isOwner = role.priority >= 100;

  return (
    <Card
      className={cn(
        'min-w-[200px] max-w-[240px] cursor-pointer transition-all border-2 hover:border-primary/50',
        isSelected ? 'border-primary shadow-md' : 'border-border',
      )}
      onClick={onSelect}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            {isOwner && <Crown className="h-3.5 w-3.5 text-amber-500" />}
            <span className="text-xs font-semibold text-foreground truncate">
              {role.display_name}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {role.is_system ? (
              <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-violet-600 dark:text-violet-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500" />
                System
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Custom
              </span>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                aria-label={`Delete ${role.display_name} role`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <p className="text-[0.65rem] text-muted-foreground line-clamp-2 mb-2.5">
          {isOwner ? 'Full access to all features' : role.description || 'No description'}
        </p>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="h-3 w-3" />
          <span className="text-[0.65rem]">
            {role.users_count} {role.users_count === 1 ? 'user' : 'users'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Module Section Component ─────────────────────────────────────────────

function ModuleSection({
  module,
  permissions,
  editedPermissions,
  isExpanded,
  onToggle,
  onPermissionChange,
  disabled,
}: {
  module: string;
  permissions: PermissionDefinition[];
  editedPermissions: Record<string, string>;
  isExpanded: boolean;
  onToggle: () => void;
  onPermissionChange: (key: string, value: string) => void;
  disabled: boolean;
}) {
  const enabledCount = permissions.filter(
    (p) => editedPermissions[p.key] && editedPermissions[p.key] !== '',
  ).length;

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-foreground">
            {getModuleLabel(module)}
          </span>
        </div>
        <span className={cn(
          'text-[0.6rem] font-medium tabular-nums',
          enabledCount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
        )}>
          {enabledCount}/{permissions.length}
        </span>
      </button>
      {isExpanded && (
        <div className="border-t border-border/40">
          {permissions.map((perm) => (
            <PermissionRow
              key={perm.key}
              permission={perm}
              value={editedPermissions[perm.key] ?? ''}
              onChange={(val) => onPermissionChange(perm.key, val)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Permission Row Component ─────────────────────────────────────────────

function PermissionRow({
  permission,
  value,
  onChange,
  disabled,
}: {
  permission: PermissionDefinition;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  if (permission.has_scope) {
    return (
      <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors">
        <div className="flex-1 min-w-0 mr-3">
          <p className="text-[0.75rem] text-foreground">{permission.description}</p>
          <p className="text-[0.6rem] text-muted-foreground">{permission.key}</p>
        </div>
        <Select
          value={(value === 'none' ? '' : value) || 'disabled'}
          onValueChange={(v) => onChange(!v || v === 'disabled' ? '' : v)}
          disabled={disabled}
        >
          <SelectTrigger className="w-[130px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || 'disabled'} value={opt.value || 'disabled'}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Boolean toggle for non-scoped permissions
  const isEnabled = value !== '' && value !== undefined;
  return (
    <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0 mr-3">
        <p className="text-[0.75rem] text-foreground">{permission.description}</p>
        <p className="text-[0.6rem] text-muted-foreground">{permission.key}</p>
      </div>
      <Switch
        checked={isEnabled}
        onCheckedChange={(checked) => onChange(checked ? 'none' : '')}
        disabled={disabled}
        aria-label={`Toggle ${permission.description}`}
      />
    </div>
  );
}
