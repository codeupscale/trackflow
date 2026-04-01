'use client';

import { useState } from 'react';
import { UserCog, Plus, Users, Trash2, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import {
  useShiftAssignments,
  useUnassignShift,
} from '@/hooks/hr/use-shift-assignments';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ShiftSelect } from '@/components/hr/ShiftSelect';
import { ShiftAssignmentDialog } from '@/components/hr/ShiftAssignmentDialog';
import { ShiftBulkAssignDialog } from '@/components/hr/ShiftBulkAssignDialog';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/utils';

export default function ShiftAssignmentsPage() {
  const { user } = useAuthStore();
  const canManage =
    user?.role === 'owner' ||
    user?.role === 'admin' ||
    user?.role === 'manager';

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

  const handleUnassignConfirm = () => {
    if (!unassignTarget || !selectedShiftId) return;
    unassignMutation.mutate(
      { shiftId: selectedShiftId, userId: unassignTarget.userId },
      { onSuccess: () => setUnassignTarget(null) }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shift Assignments"
        description="Manage which users are assigned to each shift"
        action={
          canManage && selectedShiftId ? (
            <div className="flex items-center gap-2">
              <Button onClick={() => setAssignDialogOpen(true)}>
                <Plus data-icon="inline-start" />
                Assign User
              </Button>
              <Button
                variant="outline"
                onClick={() => setBulkAssignDialogOpen(true)}
              >
                <Users data-icon="inline-start" />
                Bulk Assign
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Shift Selector */}
      <div className="max-w-sm">
        <Label className="text-sm font-medium mb-1.5 block">Select Shift</Label>
        <ShiftSelect
          value={selectedShiftId || null}
          onChange={setSelectedShiftId}
          placeholder="Choose a shift to manage"
        />
      </div>

      {/* Assignments Table */}
      {!selectedShiftId ? (
        <EmptyState
          icon={UserCog}
          title="Select a shift"
          description="Choose a shift above to view and manage its assignments."
        />
      ) : isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <UserCog className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load assignments
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col gap-0">
              <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-28" />
                ))}
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0"
                >
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : assignments.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No assignments"
          description="No users are currently assigned to this shift."
          action={
            canManage ? (
              <Button onClick={() => setAssignDialogOpen(true)}>
                <Plus data-icon="inline-start" />
                Assign User
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Effective To</TableHead>
                  {canManage && (
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell className="font-medium">
                      {assignment.user?.name ?? 'Unknown'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {assignment.user?.email ?? '--'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(assignment.effective_from)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {assignment.effective_to
                        ? formatDate(assignment.effective_to)
                        : 'Ongoing'}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setUnassignTarget({
                              userId: assignment.user_id,
                              name: assignment.user?.name ?? 'this user',
                            })
                          }
                          className="text-destructive hover:text-destructive"
                          aria-label={`Unassign ${assignment.user?.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
