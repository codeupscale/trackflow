'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2, UserCog, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TabLoading } from '@/components/ui/loader-3d';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ShiftSelect } from '@/components/hr/ShiftSelect';
import { ShiftAssignmentDialog } from '@/components/hr/ShiftAssignmentDialog';
import { ShiftBulkAssignDialog } from '@/components/hr/ShiftBulkAssignDialog';
import {
  useShiftAssignments,
  useUnassignShift,
} from '@/hooks/hr/use-shift-assignments';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { formatDate } from '@/lib/utils';

// ─── Shared helpers ──────────────────────────────────────────────────────────

const avatarColors = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ShiftManagementPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();

  // Roster and swap requests are retired (owner decision) — this screen is now
  // assignments only, so managing assignments is the only way in.
  const canManageAssignments = hasPermission('shifts.manage_assignments');

  useEffect(() => {
    if (user && !canManageAssignments) {
      router.push('/hr/shifts');
    }
  }, [user, canManageAssignments, router]);

  if (!user || !canManageAssignments) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Shift Assignment</h1>
        <p className="text-xs text-muted-foreground">
          Manage which employees are assigned to each shift
        </p>
      </div>

      <AssignmentsTab />
    </div>
  );
}

// ─── Assignments Tab ─────────────────────────────────────────────────────────

function AssignmentsTab() {
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('shifts.manage_assignments');

  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<{ userId: string; name: string } | null>(null);

  const { data, isLoading, isError } = useShiftAssignments(selectedShiftId);
  const unassignMutation = useUnassignShift();

  const assignments = data?.data ?? [];
  const totalAssignments = assignments.length;

  const handleUnassignConfirm = () => {
    if (!unassignTarget || !selectedShiftId) return;
    unassignMutation.mutate(
      { shiftId: selectedShiftId, userId: unassignTarget.userId },
      { onSuccess: () => setUnassignTarget(null) },
    );
  };

  return (
    <>
      {/* Shift Selector + Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1 w-full sm:w-[260px]">
          <Label className="text-[0.65rem] text-muted-foreground">Select Shift</Label>
          <ShiftSelect
            value={selectedShiftId || null}
            onChange={setSelectedShiftId}
            placeholder="Choose a shift..."
          />
        </div>
        {canManage && selectedShiftId && (
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8 text-xs" onClick={() => setAssignDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Assign
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBulkAssignDialogOpen(true)}>
              <Users className="h-3.5 w-3.5 mr-1" />
              Bulk Assign
            </Button>
          </div>
        )}
      </div>

      {/* Stats Strip */}
      {selectedShiftId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
                  <Users className="h-4 w-4 text-blue-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Assigned</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">
                    {isLoading ? '--' : totalAssignments}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      {!selectedShiftId ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <UserCog className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">Select a shift</p>
              <p className="text-xs text-muted-foreground">Choose a shift above to view and manage its assignments.</p>
            </div>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <UserCog className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load assignments</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <UserCog className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No assignments</p>
              <p className="text-xs text-muted-foreground">No users are currently assigned to this shift.</p>
              {canManage && (
                <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => setAssignDialogOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" />
                  Assign User
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Employee</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Effective From</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Effective To</th>
                    {canManage && (
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => {
                    const name = a.user?.name ?? 'Unknown';
                    return (
                      <tr key={a.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarFallback className={`${getAvatarColor(name)} text-white text-[0.5rem] font-medium`}>
                                {getInitials(name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-[0.75rem] font-medium truncate">{name}</p>
                              <p className="text-[0.6rem] text-muted-foreground truncate">{a.user?.email ?? ''}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                          {formatDate(a.effective_from)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                          {a.effective_to ? formatDate(a.effective_to) : (
                            <span className="text-emerald-600 dark:text-emerald-400 text-[0.65rem] font-medium">Ongoing</span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => setUnassignTarget({ userId: a.user_id, name })}
                              aria-label={`Unassign ${name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      {selectedShiftId && (
        <>
          <ShiftAssignmentDialog
            open={assignDialogOpen}
            onOpenChange={setAssignDialogOpen}
            shiftId={selectedShiftId}
          />
          <ShiftBulkAssignDialog
            open={bulkAssignDialogOpen}
            onOpenChange={setBulkAssignDialogOpen}
            shiftId={selectedShiftId}
          />
        </>
      )}

      <ConfirmDialog
        open={!!unassignTarget}
        onOpenChange={(open) => { if (!open) setUnassignTarget(null); }}
        title="Unassign User"
        description={`Are you sure you want to unassign "${unassignTarget?.name}" from this shift?`}
        confirmLabel="Unassign"
        onConfirm={handleUnassignConfirm}
        isPending={unassignMutation.isPending}
      />
    </>
  );
}
