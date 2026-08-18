'use client';

import { useState } from 'react';
import { UserCog, Plus, Users, Trash2, CheckCircle2, CalendarClock } from 'lucide-react';
import { usePermissionStore } from '@/stores/permission-store';
import {
  useShiftAssignments,
  useUnassignShift,
} from '@/hooks/hr/use-shift-assignments';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ShiftSelect } from '@/components/hr/ShiftSelect';
import { ShiftAssignmentDialog } from '@/components/hr/ShiftAssignmentDialog';
import { ShiftBulkAssignDialog } from '@/components/hr/ShiftBulkAssignDialog';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/utils';

export default function ShiftAssignmentsPage() {
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('shifts.manage_assignments');

  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [bulkAssignDialogOpen, setBulkAssignDialogOpen] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<{
    userId: string;
    name: string;
  } | null>(null);

  const { data, isLoading, isError } = useShiftAssignments(selectedShiftId);
  const unassignMutation = useUnassignShift();

  const assignments = data?.data ?? [];

  const ongoingCount = assignments.filter((a) => !a.effective_to).length;
  const timeBoundCount = assignments.filter((a) => !!a.effective_to).length;

  const handleUnassignConfirm = () => {
    if (!unassignTarget || !selectedShiftId) return;
    unassignMutation.mutate(
      { shiftId: selectedShiftId, userId: unassignTarget.userId },
      { onSuccess: () => setUnassignTarget(null) }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Shift Assignments</h1>
          <p className="text-xs text-muted-foreground">
            Manage which users are assigned to each shift
          </p>
        </div>
        {canManage && selectedShiftId && (
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8 text-xs" onClick={() => setAssignDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Assign User
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setBulkAssignDialogOpen(true)}
            >
              <Users className="h-3.5 w-3.5 mr-1" />
              Bulk Assign
            </Button>
          </div>
        )}
      </div>

      {/* Shift Selector */}
      <div className="max-w-sm">
        <label className="text-xs font-medium mb-1.5 block text-foreground">Select Shift</label>
        <ShiftSelect
          value={selectedShiftId || null}
          onChange={setSelectedShiftId}
          placeholder="Choose a shift to manage"
        />
      </div>

      {/* Stats Strip */}
      {selectedShiftId && !isError && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total', value: assignments.length, icon: UserCog, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { label: 'Ongoing', value: ongoingCount, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            { label: 'Time-bound', value: timeBoundCount, icon: CalendarClock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          ].map((s) => (
            <Card key={s.label} className="border-border">
              <CardContent className="p-3">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                    <p className="text-base font-bold text-foreground tabular-nums leading-tight">
                      {isLoading ? '--' : s.value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Assignments Table */}
      {!selectedShiftId ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <UserCog className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">Select a shift</p>
              <p className="text-xs text-muted-foreground">
                Choose a shift above to view and manage its assignments.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <UserCog className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">
                Failed to load assignments
              </p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-20" />
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0"
              >
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <UserCog className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No assignments</p>
              <p className="text-xs text-muted-foreground">
                No users are currently assigned to this shift.
              </p>
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
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Email</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Effective From</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Effective To</th>
                    {canManage && (
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] font-medium">
                        {assignment.user?.name ?? 'Unknown'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                        {assignment.user?.email ?? '--'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-muted-foreground">
                        {formatDate(assignment.effective_from)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                        {assignment.effective_to ? (
                          <span className="tabular-nums">{formatDate(assignment.effective_to)}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Ongoing
                          </span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setUnassignTarget({
                                userId: assignment.user_id,
                                name: assignment.user?.name ?? 'this user',
                              })
                            }
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            aria-label={`Unassign ${assignment.user?.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assign Dialog */}
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

      {/* Unassign Confirmation */}
      <ConfirmDialog
        open={!!unassignTarget}
        onOpenChange={(open) => {
          if (!open) setUnassignTarget(null);
        }}
        title="Unassign User"
        description={`Are you sure you want to unassign "${unassignTarget?.name}" from this shift?`}
        confirmLabel="Unassign"
        onConfirm={handleUnassignConfirm}
        isPending={unassignMutation.isPending}
      />
    </div>
  );
}
