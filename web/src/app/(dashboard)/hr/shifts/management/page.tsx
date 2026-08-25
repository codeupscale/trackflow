'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import {
  ArrowLeftRight,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Hourglass,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserCog,
  Users,
  X,
  XCircle,
  CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TabLoading } from '@/components/ui/loader-3d';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectGroup,
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ShiftSelect } from '@/components/hr/ShiftSelect';
import { ShiftAssignmentDialog } from '@/components/hr/ShiftAssignmentDialog';
import { ShiftBulkAssignDialog } from '@/components/hr/ShiftBulkAssignDialog';
import { ShiftRosterCalendar } from '@/components/hr/ShiftRosterCalendar';
import { useShiftRoster } from '@/hooks/hr/use-shift-roster';
import {
  useShiftAssignments,
  useUnassignShift,
} from '@/hooks/hr/use-shift-assignments';
import {
  useShiftSwaps,
  useCreateShiftSwap,
  useApproveSwap,
  useRejectSwap,
  useCancelSwap,
} from '@/hooks/hr/use-shift-swaps';
import { useEmployees } from '@/hooks/hr/use-employees';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { cn, formatDate } from '@/lib/utils';
import type { ShiftSwapRequest } from '@/lib/validations/shift';

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

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  pending: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Pending' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  rejected: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Rejected' },
  cancelled: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'Cancelled' },
};

type Tab = 'roster' | 'assignments' | 'swaps';

const rejectNoteSchema = z.object({
  reviewer_note: z.string().min(1, 'Review note is required').max(500, 'Must be 500 characters or less'),
});
type RejectNoteFormData = z.infer<typeof rejectNoteSchema>;

// ─── Roster helpers ──────────────────────────────────────────────────────────

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split('T')[0];
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const yearFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
  return `${fmt.format(start)} – ${fmt.format(end)}, ${yearFmt.format(end)}`;
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ShiftManagementPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();

  const canManageAssignments = hasPermission('shifts.manage_assignments');
  const canViewShifts = hasPermission('shifts.view');

  const hasAccess = canManageAssignments || canViewShifts;

  useEffect(() => {
    if (user && !hasAccess) {
      router.push('/hr/shifts');
    }
  }, [user, hasAccess, router]);

  const defaultTab: Tab = canManageAssignments ? 'roster' : 'swaps';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  if (!user || !hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof CalendarRange; show: boolean }[] = [
    { key: 'roster', label: 'Roster', icon: CalendarRange, show: canManageAssignments },
    { key: 'assignments', label: 'Assignments', icon: UserCog, show: canManageAssignments },
    { key: 'swaps', label: 'Swap Requests', icon: ArrowLeftRight, show: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Shift Management</h1>
        <p className="text-xs text-muted-foreground">
          Manage rosters, assignments, and swap requests
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[0.7rem] font-medium transition-colors',
              activeTab === t.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'roster' && canManageAssignments && <RosterTab />}
      {activeTab === 'assignments' && canManageAssignments && <AssignmentsTab />}
      {activeTab === 'swaps' && <SwapsTab />}
    </div>
  );
}

// ─── Roster Tab ──────────────────────────────────────────────────────────────

function RosterTab() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const { data: roster, isLoading, isError } = useShiftRoster(weekStart);
  const weekLabel = useMemo(() => formatWeekRange(weekStart), [weekStart]);

  const hasData = roster && Object.values(roster).some((entries) => entries.length > 0);

  return (
    <>
      {/* Week Navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWeekStart((w) => addWeeks(w, -1))}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs font-medium text-foreground min-w-[180px] text-center">
            {weekLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWeekStart((w) => addWeeks(w, 1))}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setWeekStart(getMonday(new Date()))}
          >
            Today
          </Button>
        </div>
        <Input
          type="date"
          value={weekStart}
          onChange={(e) => {
            if (e.target.value) setWeekStart(getMonday(new Date(e.target.value + 'T00:00:00')));
          }}
          className="h-8 text-xs w-[140px]"
          aria-label="Jump to week"
        />
      </div>

      {/* Roster Content */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <CalendarRange className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load roster</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : !hasData ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <CalendarRange className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No shifts scheduled</p>
              <p className="text-xs text-muted-foreground">
                No shift assignments found for this week. Assign users to shifts to see them here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-3">
            <ShiftRosterCalendar roster={roster ?? {}} weekStart={weekStart} />
          </CardContent>
        </Card>
      )}
    </>
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

// ─── Swaps Tab ───────────────────────────────────────────────────────────────

const SWAP_STATUS_FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;

function SwapsTab() {
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canManageSwaps = hasPermission('shifts.manage_swaps');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ShiftSwapRequest | null>(null);

  const [targetUserId, setTargetUserId] = useState('');
  const [swapDate, setSwapDate] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [empSearch, setEmpSearch] = useState('');

  const { data, isLoading, isError } = useShiftSwaps({
    status: statusFilter,
    page: currentPage,
  });
  const { data: employeesData } = useEmployees({
    search: empSearch || undefined,
    per_page: 50,
  });

  const createSwapMutation = useCreateShiftSwap();
  const approveSwapMutation = useApproveSwap();
  const rejectSwapMutation = useRejectSwap();
  const cancelSwapMutation = useCancelSwap();

  const rejectForm = useForm<RejectNoteFormData>({
    resolver: zodResolver(rejectNoteSchema) as any,
  });

  const swaps = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;
  const totalCount = data?.total ?? 0;
  const employees = employeesData?.data ?? [];

  const pendingCount = swaps.filter((s) => s.status === 'pending').length;
  const approvedCount = swaps.filter((s) => s.status === 'approved').length;
  const rejectedCount = swaps.filter((s) => s.status === 'rejected').length;

  const handleCreateSwap = () => {
    if (!targetUserId || !swapDate) return;
    createSwapMutation.mutate(
      { target_user_id: targetUserId, swap_date: swapDate, reason: swapReason || null },
      {
        onSuccess: () => {
          setCreateDialogOpen(false);
          setTargetUserId('');
          setSwapDate('');
          setSwapReason('');
        },
      },
    );
  };

  const handleRejectSubmit = (formData: RejectNoteFormData) => {
    if (!rejectTarget) return;
    rejectSwapMutation.mutate(
      { id: rejectTarget.id, reviewer_note: formData.reviewer_note },
      { onSuccess: () => { setRejectTarget(null); rejectForm.reset(); } },
    );
  };

  return (
    <>
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: totalCount, icon: ArrowLeftRight, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Pending', value: statusFilter === 'pending' ? totalCount : pendingCount, icon: Hourglass, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Approved', value: approvedCount, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Rejected', value: rejectedCount, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
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

      {/* Filters + Create */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {SWAP_STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => { setStatusFilter(status); setCurrentPage(1); }}
              className={cn(
                'rounded-md px-3 py-1.5 text-[0.65rem] font-medium transition-colors capitalize',
                statusFilter === status
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={statusFilter === status}
            >
              {status}
            </button>
          ))}
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => setCreateDialogOpen(true)}>
          <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
          Request Swap
        </Button>
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <ArrowLeftRight className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load swap requests</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : swaps.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <ArrowLeftRight className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                No {statusFilter !== 'all' ? statusFilter : ''} swap requests
              </p>
              <p className="text-xs text-muted-foreground">
                {statusFilter === 'pending'
                  ? 'No pending requests to review.'
                  : 'No swap requests match the selected filter.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Requester</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Swap With</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Date</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Reason</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {swaps.map((swap) => {
                      const sd = statusDot[swap.status] ?? statusDot.pending;
                      const requesterName = swap.requester?.name ?? 'Unknown';
                      const targetName = swap.target_user?.name ?? 'Unknown';
                      const isOwn = user?.id === swap.requester_id;

                      return (
                        <tr key={swap.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className={`${getAvatarColor(requesterName)} text-white text-[0.5rem] font-medium`}>
                                  {getInitials(requesterName)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-[0.75rem] font-medium truncate">
                                  {requesterName}
                                  {isOwn && <span className="text-[0.6rem] text-muted-foreground ml-1">(you)</span>}
                                </p>
                                <p className="text-[0.6rem] text-muted-foreground truncate">{swap.requester?.email ?? ''}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className={`${getAvatarColor(targetName)} text-white text-[0.5rem] font-medium`}>
                                  {getInitials(targetName)}
                                </AvatarFallback>
                              </Avatar>
                              <p className="text-[0.75rem] font-medium truncate">{targetName}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                            {formatDate(swap.swap_date)}
                          </td>
                          <td className="px-4 py-2.5 max-w-[160px]">
                            {swap.reason ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={<span />}
                                  className="text-[0.7rem] text-muted-foreground truncate block cursor-help"
                                  tabIndex={0}
                                >
                                  {swap.reason}
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">{swap.reason}</p>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-[0.65rem] text-muted-foreground/50">&mdash;</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                              {sd.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            {swap.status === 'pending' ? (
                              <div className="inline-flex items-center gap-1.5">
                                {canManageSwaps && (
                                  <>
                                    <Button
                                      size="sm"
                                      className="h-6 px-2.5 text-[0.6rem] bg-emerald-600 hover:bg-emerald-700 text-white"
                                      onClick={() => approveSwapMutation.mutate(swap.id)}
                                      disabled={approveSwapMutation.isPending}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2.5 text-[0.6rem] text-destructive hover:text-destructive"
                                      onClick={() => { setRejectTarget(swap); rejectForm.reset(); }}
                                      disabled={rejectSwapMutation.isPending}
                                    >
                                      Reject
                                    </Button>
                                  </>
                                )}
                                {isOwn && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2.5 text-[0.6rem] text-muted-foreground"
                                    onClick={() => cancelSwapMutation.mutate(swap.id)}
                                    disabled={cancelSwapMutation.isPending}
                                  >
                                    Cancel
                                  </Button>
                                )}
                              </div>
                            ) : swap.reviewer ? (
                              <span className="text-[0.6rem] text-muted-foreground">
                                by {swap.reviewer.name}
                              </span>
                            ) : (
                              <span className="text-[0.65rem] text-muted-foreground/50">&mdash;</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[0.65rem] text-muted-foreground">Page {currentPage} of {totalPages}</p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      aria-disabled={currentPage === 1}
                      className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                      acc.push(p);
                      return acc;
                    }, [] as number[])
                    .map((p, idx) =>
                      p === -1 ? (
                        <PaginationItem key={`e-${idx}`}><PaginationEllipsis /></PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink isActive={p === currentPage} onClick={() => setCurrentPage(p)} className="cursor-pointer">
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={currentPage === totalPages}
                      className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}

      {/* Create Swap Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Request Shift Swap</DialogTitle>
            <DialogDescription className="text-xs">
              Request to swap your shift with another team member.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Swap With</Label>
              <Select value={targetUserId} onValueChange={(val) => { if (val) setTargetUserId(val); }}>
                <SelectTrigger className="h-9 text-sm" aria-label="Select employee">
                  {/* Items carry the user id as their value, and Base UI renders
                      the RAW value unless given a mapping function — without
                      this the trigger shows a uuid instead of the name. */}
                  <SelectValue placeholder="Select employee">
                    {(value: string | null) => {
                      if (!value) return 'Select employee';
                      return employees.find((e) => e.id === value)?.name ?? 'Select employee';
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Search employees..."
                      value={empSearch}
                      onChange={(e) => setEmpSearch(e.target.value)}
                      className="h-8 text-xs mb-2"
                    />
                  </div>
                  <SelectGroup>
                    {employees
                      .filter((emp) => emp.id !== user?.id)
                      .map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.name} ({emp.email})
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="swap-date" className="text-xs">Swap Date</Label>
              <Input
                id="swap-date"
                type="date"
                className="h-9 text-sm"
                value={swapDate}
                onChange={(e) => setSwapDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="swap-reason" className="text-xs">Reason (optional)</Label>
              <Textarea
                id="swap-reason"
                rows={3}
                className="text-sm resize-none"
                placeholder="Why do you want to swap shifts?"
                value={swapReason}
                onChange={(e) => setSwapReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)} disabled={createSwapMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCreateSwap}
              disabled={createSwapMutation.isPending || !targetUserId || !swapDate}
            >
              {createSwapMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); rejectForm.reset(); } }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={rejectForm.handleSubmit(handleRejectSubmit)}>
            <DialogHeader>
              <DialogTitle className="text-base">Reject Swap Request</DialogTitle>
              <DialogDescription className="text-xs">
                Please provide a reason for rejecting{' '}
                <span className="font-medium text-foreground">{rejectTarget?.requester?.name}</span>&apos;s
                swap request for <span className="font-medium text-foreground">{rejectTarget ? formatDate(rejectTarget.swap_date) : ''}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 grid gap-1.5">
              <Label htmlFor="reviewer_note" className="text-xs">Review Note</Label>
              <Textarea
                id="reviewer_note"
                rows={3}
                placeholder="Enter the reason for rejection..."
                className="text-sm resize-none"
                {...rejectForm.register('reviewer_note')}
                aria-invalid={!!rejectForm.formState.errors.reviewer_note}
              />
              {rejectForm.formState.errors.reviewer_note && (
                <p className="text-[0.65rem] text-destructive">{rejectForm.formState.errors.reviewer_note.message}</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" size="sm" disabled={rejectSwapMutation.isPending}>
                {rejectSwapMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Reject Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
