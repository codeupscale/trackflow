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
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';
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
  { value: 'team', label: 'Team' },
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
    // Convert '' to 'none' for the API (disabled permissions)
    const permissions: Record<string, string> = {};
    for (const [key, scope] of Object.entries(editedPermissions)) {
      permissions[key] = scope || 'none';
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
    // Create with all permissions disabled by default
    const permissions: Record<string, string> = {};
    if (permissionsList) {
      for (const perms of Object.values(permissionsList)) {
        for (const p of perms) {
          permissions[p.key] = 'none';
        }
      }
    }
    createMutation.mutate(
      {
        display_name: createName.trim(),
        description: createDescription.trim() || undefined,
        permissions,
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
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteOpen(false);
        setDeleteTarget(null);
        if (selectedRoleId === deleteTarget.id) {
          setSelectedRoleId(null);
          setEditedPermissions({});
          setHasChanges(false);
        }
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

  // ── Access check ───────────────────────────────────────────────────────

  if (!hasPermission('roles.view')) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <Shield className="size-10 text-muted-foreground" />
        <p className="text-muted-foreground">You do not have access to view roles.</p>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────

  if (rolesLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-56 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────

  if (rolesError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-destructive">Failed to load roles.</p>
        <Button
          variant="outline"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    );
  }

  const sortedRoles = [...(roles ?? [])].sort((a, b) => b.priority - a.priority);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Roles & Permissions</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage roles and configure what each role can access
          </p>
        </div>
        {hasPermission('roles.create') && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" />
            Create Custom Role
          </Button>
        )}
      </div>

      {/* Role Cards */}
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4">
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
        <Card className="border-border bg-card">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-foreground">
                  {isOwnerRole ? 'Viewing' : 'Editing'}: {selectedRole?.display_name}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {isOwnerRole
                    ? 'Owner has full access to all features'
                    : selectedRole?.is_system
                      ? 'System role — permissions can be customized'
                      : 'Custom role — fully configurable'}
                </CardDescription>
              </div>
              {!isOwnerRole && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={expandAll}>
                    Expand All
                  </Button>
                  <Button variant="outline" size="sm" onClick={collapseAll}>
                    Collapse All
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isOwnerRole ? (
              <Alert className="border-primary/20 bg-primary/5">
                <Info className="size-4" />
                <div className="ml-2">
                  <p className="text-sm font-medium text-foreground">Full Access</p>
                  <p className="text-sm text-muted-foreground">
                    The Owner role has unrestricted access to all features and modules.
                    Permissions cannot be modified.
                  </p>
                </div>
              </Alert>
            ) : roleDetailLoading || permsLoading ? (
              <div className="flex flex-col gap-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : permissionsList ? (
              <div className="flex flex-col gap-2">
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
                    <Separator className="my-4" />
                    <div className="flex gap-3 justify-end">
                      <Button
                        variant="outline"
                        onClick={handleCancel}
                        disabled={!hasChanges || updateMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleSave}
                        disabled={!hasChanges || updateMutation.isPending}
                      >
                        {updateMutation.isPending && (
                          <Loader2 className="mr-2 size-4 animate-spin" />
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
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Shield className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground font-medium">Select a role to view permissions</p>
            <p className="text-sm text-muted-foreground">
              Click on any role card above to view or edit its permissions
            </p>
          </CardContent>
        </Card>
      )}

      {/* Create Role Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Custom Role</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a new role with custom permissions. All permissions start disabled.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-name" className="text-foreground">
                Display Name
              </Label>
              <Input
                id="role-name"
                placeholder="e.g. HR Manager, Project Lead"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-desc" className="text-foreground">
                Description
              </Label>
              <Textarea
                id="role-desc"
                placeholder="What is this role responsible for?"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                className="bg-muted border-border text-foreground resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!createName.trim() || createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Role</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {deleteTarget && deleteTarget.users_count > 0
                ? `This role has ${deleteTarget.users_count} user(s) assigned. Please reassign them before deleting.`
                : `Are you sure you want to delete the "${deleteTarget?.display_name}" role? This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
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
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
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
        'min-w-[220px] max-w-[260px] cursor-pointer transition-all border-2 bg-card hover:border-primary/50',
        isSelected ? 'border-primary shadow-md' : 'border-border',
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {isOwner && <Crown className="size-4 text-amber-500" />}
            <CardTitle className="text-sm font-semibold text-foreground">
              {role.display_name}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {role.is_system && (
              <Badge variant="secondary" className="text-xs">
                System
              </Badge>
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
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {isOwner ? 'Full access to all features' : role.description || 'No description'}
        </p>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="size-3.5" />
          <span className="text-xs">
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
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium text-foreground">
            {getModuleLabel(module)}
          </span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {enabledCount}/{permissions.length}
        </Badge>
      </button>
      {isExpanded && (
        <div className="border-t border-border">
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
      <div className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors">
        <div className="flex-1 min-w-0 mr-4">
          <p className="text-sm text-foreground">{permission.description}</p>
          <p className="text-xs text-muted-foreground">{permission.key}</p>
        </div>
        <Select
          value={value || 'disabled'}
          onValueChange={(v) => onChange(!v || v === 'disabled' ? '' : v)}
          disabled={disabled}
        >
          <SelectTrigger className="w-[150px] bg-muted border-border text-sm">
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
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-sm text-foreground">{permission.description}</p>
        <p className="text-xs text-muted-foreground">{permission.key}</p>
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

