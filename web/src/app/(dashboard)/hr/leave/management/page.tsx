'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Calendar,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Hourglass,
  ListChecks,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Repeat,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCodeFromName, slugCode } from '@/hooks/use-code-from-name';
import { TabLoading } from '@/components/ui/loader-3d';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn, codeBadgeColor } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { LeaveCalendar } from '@/components/hr/LeaveCalendar';
import { LeaveRequestModal } from '@/components/hr/LeaveRequestModal';
import { EmployeeSelect } from '@/components/hr/EmployeeSelect';
import { PeriodFilter, periodToRange, type Period } from '@/components/common/PeriodFilter';
import { useLeaveRequests } from '@/hooks/hr/use-leave-requests';
import { useLeaveTypes } from '@/hooks/hr/use-leave-types';
import { useApproveLeave, useRejectLeave } from '@/hooks/hr/use-leave-actions';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { formatDate } from '@/lib/utils';
import api from '@/lib/api';
import {
  rejectLeaveSchema,
  leaveTypeFormSchema,
  type RejectLeaveFormData,
  type LeaveRequest,
  type LeaveTypeFormData,
  type LeaveType,
} from '@/lib/validations/leave';

// ─── Shared helpers ──────────────────────────────────────────────────────────

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  pending: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Pending' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  rejected: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Rejected' },
  cancelled: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'Cancelled' },
};

const avatarColors = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function formatDays(count: number) {
  const n = Number(count);
  if (n === 0.5) return 'Half day';
  return Math.round(n);
}

type Tab = 'approvals' | 'calendar' | 'types' | 'holidays';

// ─── Main page ───────────────────────────────────────────────────────────────

export default function LeaveManagementPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canApprove = hasPermission('leave.approve');
  const canManageTypes = hasPermission('leave.manage_types');
  const canViewCalendar = hasPermission('leave.view_calendar');
  const canManageHolidays = hasPermission('leave.manage_holidays');

  const hasAccess = canApprove || canManageTypes || canViewCalendar;

  useEffect(() => {
    if (user && !hasAccess) {
      router.push('/hr/leave');
    }
  }, [user, hasAccess, router]);

  const defaultTab: Tab = canApprove ? 'approvals' : canViewCalendar ? 'calendar' : 'types';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  // Holiday period filter — the SAME control as the Approvals tab (presets +
  // any-month grid). Lives here so it sits on the tab-bar row, right-aligned,
  // while only the Holidays tab consumes it.
  const [holidayPeriod, setHolidayPeriod] = useState<Period>({ kind: 'all' });

  if (!user || !hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof ClipboardCheck; show: boolean }[] = [
    { key: 'approvals', label: 'Approvals', icon: ClipboardCheck, show: canApprove },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays, show: canViewCalendar },
    { key: 'types', label: 'Leave Types', icon: ListChecks, show: canManageTypes },
    { key: 'holidays', label: 'Holidays', icon: Calendar, show: canManageHolidays },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Leave Management</h1>
        <p className="text-xs text-muted-foreground">
          Manage approvals, calendar, and leave types
        </p>
      </div>

      {/* Tab bar — the holiday period filter sits IMMEDIATELY beside the tab
          pills (not at the far edge) while the Holidays tab is active */}
      <div className="flex items-center gap-3">
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
        {activeTab === 'holidays' && canManageHolidays && (
          <PeriodFilter value={holidayPeriod} onChange={setHolidayPeriod} />
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'approvals' && canApprove && <ApprovalsTab />}
      {activeTab === 'calendar' && canViewCalendar && <CalendarTab />}
      {activeTab === 'types' && canManageTypes && <LeaveTypesTab />}
      {activeTab === 'holidays' && canManageHolidays && <HolidaysTab period={holidayPeriod} />}
    </div>
  );
}

// ─── Approvals Tab ───────────────────────────────────────────────────────────

function ApprovalsTab() {
  const { user } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [currentPage, setCurrentPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [viewTarget, setViewTarget] = useState<LeaveRequest | null>(null);

  // Mirrors LeaveRequestPolicy::approve — nobody may act on their OWN request
  // except the owner, who has no one above them to decide it. Without this the
  // buttons render on an approver's own row and every click 403s.
  const canActOn = (req: LeaveRequest) =>
    req.user?.id !== user?.id || user?.role === 'owner';

  // Which ROW is currently in flight. `approveMutation.isPending` is a single
  // flag on one mutation object shared by every row, so gating buttons on it
  // made one click appear to press every button in the table. TanStack exposes
  // the in-flight `variables`, so the acting row can be identified without
  // adding separate state.
  const isApproving = (id: string) =>
    approveMutation.isPending && approveMutation.variables === id;
  const isRejecting = (id: string) =>
    rejectMutation.isPending && rejectMutation.variables?.id === id;
  const isActing = (id: string) => isApproving(id) || isRejecting(id);

  // ── Filters: employee (approver roles only), period, custom date range ──
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>({ kind: 'all' });

  const dateRange = useMemo(() => periodToRange(period), [period]);

  const { data, isLoading, isError } = useLeaveRequests({
    status: statusFilter,
    page: currentPage,
    user_id: employeeFilter ?? undefined,
    ...dateRange,
  });
  const approveMutation = useApproveLeave();
  const rejectMutation = useRejectLeave();

  const rejectForm = useForm<RejectLeaveFormData>({
    resolver: zodResolver(rejectLeaveSchema) as any,
  });

  const requests = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;

  const handleRejectSubmit = (formData: RejectLeaveFormData) => {
    if (!rejectTarget) return;
    rejectMutation.mutate(
      { id: rejectTarget.id, rejection_reason: formData.rejection_reason },
      { onSuccess: () => { setRejectTarget(null); rejectForm.reset(); } },
    );
  };

  const handleBulkApprove = async () => {
    // Skip the approver's own request — the server would 403 it anyway.
    const pendingRequests = requests.filter((r) => r.status === 'pending' && canActOn(r));
    for (const req of pendingRequests) {
      await approveMutation.mutateAsync(req.id);
    }
  };

  return (
    <>
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: data?.total ?? 0, icon: Calendar, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Pending', value: requests.filter((r) => r.status === 'pending').length, icon: Hourglass, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Approved', value: requests.filter((r) => r.status === 'approved').length, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Rejected', value: requests.filter((r) => r.status === 'rejected').length, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
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

      {/* Filters (employee · month/range · status) + Approve All */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Employee filter — approver roles only, never the employee role */}
        {user?.role !== 'employee' && (
          <div className="w-52">
            <EmployeeSelect
              value={employeeFilter}
              onChange={(v) => { setEmployeeFilter(v); setCurrentPage(1); }}
              placeholder="All employees"
            />
          </div>
        )}

        {/* Period — presets + any-month grid */}
        <PeriodFilter
          value={period}
          onChange={(p) => { setPeriod(p); setCurrentPage(1); }}
        />

        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {['pending', 'approved', 'rejected', 'all'].map((status) => (
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
        {statusFilter === 'pending' && requests.length > 1 && (
          <Button
            size="sm"
            className="h-7 text-[0.65rem] ml-auto"
            onClick={handleBulkApprove}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <CheckCheck className="h-3 w-3 mr-1" />
            )}
            Approve All ({requests.filter((r) => r.status === 'pending' && canActOn(r)).length})
          </Button>
        )}
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <Calendar className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load requests</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Calendar className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                No {statusFilter === 'all' ? '' : statusFilter} leave requests
              </p>
              <p className="text-xs text-muted-foreground">
                {statusFilter === 'pending'
                  ? 'All caught up! No pending requests to review.'
                  : 'No requests match the selected filter.'}
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Employee</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Leave Type</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">From</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">To</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-center">Days</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((req) => {
                      const sd = statusDot[req.status] ?? statusDot.pending;
                      const initials = req.user.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2);

                      return (
                        <tr
                          key={req.id}
                          onClick={() => setViewTarget(req)}
                          className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={req.user.avatar_url || undefined} alt={req.user.name} />
                                <AvatarFallback className={`${getAvatarColor(req.user.name)} text-white text-[0.5rem] font-medium`}>
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-[0.75rem] font-medium truncate">{req.user.name}</p>
                                <p className="text-[0.6rem] text-muted-foreground truncate">{req.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem]">{req.leave_type.name}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">{formatDate(req.start_date)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">{formatDate(req.end_date)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-center">
                            <span className="text-[0.75rem] font-semibold tabular-nums">{formatDays(req.days_count)}</span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                              {sd.label}
                            </span>
                          </td>
                          {/* stopPropagation so Approve/Reject don't also open
                              the row's view modal. */}
                          <td className="px-4 py-2.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                            {req.status === 'pending' && canActOn(req) ? (
                              <div className="inline-flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => approveMutation.mutate(req.id)}
                                  // Gate on THIS row's id, not the shared
                                  // isPending — that flag belongs to the one
                                  // mutation object behind the whole table, so
                                  // using it lit up every row's button at once.
                                  disabled={isActing(req.id)}
                                >
                                  {isApproving(req.id) && (
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  )}
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] text-destructive hover:text-destructive"
                                  onClick={() => { setRejectTarget(req); rejectForm.reset(); }}
                                  disabled={isActing(req.id)}
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : req.status === 'pending' ? (
                              <span className="text-[0.65rem] text-muted-foreground/60 italic">Your request</span>
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

      {/* Row view/edit modal — re-resolved from the refetched list by id so a
          save shows saved values, not the click-time snapshot. */}
      <LeaveRequestModal
        request={viewTarget ? (requests.find((r) => r.id === viewTarget.id) ?? viewTarget) : null}
        open={!!viewTarget}
        onOpenChange={(o) => { if (!o) setViewTarget(null); }}
      />

      {/* Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); rejectForm.reset(); } }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={rejectForm.handleSubmit(handleRejectSubmit)}>
            <DialogHeader>
              <DialogTitle className="text-base">Reject Leave Request</DialogTitle>
              <DialogDescription className="text-xs">
                Please provide a reason for rejecting{' '}
                <span className="font-medium text-foreground">{rejectTarget?.user.name}</span>&apos;s leave request.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 grid gap-1.5">
              <Label htmlFor="rejection_reason" className="text-xs">Reason</Label>
              <Textarea
                id="rejection_reason"
                rows={3}
                placeholder="Enter the reason for rejection..."
                className="text-sm resize-none"
                {...rejectForm.register('rejection_reason')}
                aria-invalid={!!rejectForm.formState.errors.rejection_reason}
              />
              {rejectForm.formState.errors.rejection_reason && (
                <p className="text-[0.65rem] text-destructive">{rejectForm.formState.errors.rejection_reason.message}</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" size="sm" disabled={rejectMutation.isPending}>
                {rejectMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Reject Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Calendar Tab ────────────────────────────────────────────────────────────

interface PublicHoliday {
  id: string;
  name: string;
  date: string;
  is_recurring: boolean;
  is_pinned?: boolean;
}

function CalendarTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  return (
    <LeaveCalendar month={month} year={year} onMonthChange={(m, y) => { setMonth(m); setYear(y); }} />
  );
}

// ─── Holidays Tab — announce public holidays org-wide ────────────────────────

function HolidaysTab({ period }: { period: Period }) {
  const now = new Date();
  const queryClient = useQueryClient();

  const [showAddDialog, setShowAddDialog] = useState(false);
  // Non-null while editing an existing holiday; null means "announce new".
  // The same dialog serves both so the fields can never drift apart.
  const [editingHoliday, setEditingHoliday] = useState<PublicHoliday | null>(null);
  const [holidayName, setHolidayName] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayRecurring, setHolidayRecurring] = useState(false);

  const openAddHoliday = () => {
    setEditingHoliday(null);
    setHolidayName('');
    setHolidayDate('');
    setHolidayRecurring(false);
    setShowAddDialog(true);
  };

  const openEditHoliday = (h: PublicHoliday) => {
    setEditingHoliday(h);
    setHolidayName(h.name);
    setHolidayDate(h.date.slice(0, 10));
    setHolidayRecurring(!!h.is_recurring);
    setShowAddDialog(true);
  };
  const [deleteTarget, setDeleteTarget] = useState<PublicHoliday | null>(null);

  const { data: holidays, isLoading: holidaysLoading } = useQuery<PublicHoliday[]>({
    queryKey: ['public-holidays'],
    queryFn: async () => {
      const res = await api.get('/hr/public-holidays');
      const raw = res.data;
      return raw.data ?? raw.holidays ?? (Array.isArray(raw) ? raw : []);
    },
  });

  const addHolidayMutation = useMutation({
    mutationFn: async (data: { name: string; date: string; is_recurring: boolean }) => api.post('/hr/public-holidays', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-holidays'] });
      queryClient.invalidateQueries({ queryKey: ['leave-calendar'] });
      toast.success('Public holiday added');
      setShowAddDialog(false);
      setHolidayName('');
      setHolidayDate('');
      setHolidayRecurring(false);
    },
    onError: (e: unknown) =>
      toast.error((e as { data?: { message?: string } })?.data?.message ?? 'Failed to add holiday'),
  });

  const editHolidayMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; date: string; is_recurring: boolean }) =>
      api.put(`/hr/public-holidays/${data.id}`, {
        name: data.name,
        date: data.date,
        is_recurring: data.is_recurring,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-holidays'] });
      queryClient.invalidateQueries({ queryKey: ['leave-calendar'] });
      toast.success('Holiday updated');
      setShowAddDialog(false);
      setEditingHoliday(null);
    },
    onError: (e: unknown) =>
      toast.error((e as { data?: { message?: string } })?.data?.message ?? 'Failed to update holiday'),
  });

  const pinHolidayMutation = useMutation({
    mutationFn: async (h: PublicHoliday) => api.put(`/hr/public-holidays/${h.id}/pin`),
    onSuccess: (_res, h) => {
      queryClient.invalidateQueries({ queryKey: ['public-holidays'] });
      toast.success(h.is_pinned ? 'Removed from headline' : 'Posted to headline');
    },
    onError: () => toast.error('Failed to update headline'),
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/hr/public-holidays/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-holidays'] });
      queryClient.invalidateQueries({ queryKey: ['leave-calendar'] });
      toast.success('Public holiday removed');
      setDeleteTarget(null);
    },
    onError: () => toast.error('Failed to remove holiday'),
  });

  const handleSaveHoliday = () => {
    if (!holidayName.trim() || !holidayDate) return;
    const payload = { name: holidayName.trim(), date: holidayDate, is_recurring: holidayRecurring };
    if (editingHoliday) {
      editHolidayMutation.mutate({ id: editingHoliday.id, ...payload });
    } else {
      addHolidayMutation.mutate(payload);
    }
  };
  const holidaySaving = addHolidayMutation.isPending || editHolidayMutation.isPending;

  // Period filter (parent-owned, on the tab-bar row) — applied client-side:
  // the list is small and fully loaded. One-time holidays must lie inside the
  // range. Recurring ones happen yearly FROM THEIR FIRST YEAR ONWARD, so they
  // match when their month/day lands in the range in any year the range spans
  // that is >= their first year — "March 2025" must not list a yearly holiday
  // first dated 2026, but "March 2027" must.
  const range = periodToRange(period);
  const inPeriod = (h: PublicHoliday): boolean => {
    const { start_date, end_date } = range;
    if (!start_date && !end_date) return true;
    const start = start_date ?? '0000-01-01';
    const end = end_date ?? '9999-12-31';
    const d = h.date.slice(0, 10);
    if (!h.is_recurring) return d >= start && d <= end;
    const firstYear = Number(d.slice(0, 4));
    const md = d.slice(5); // MM-DD
    for (let y = Math.max(firstYear, Number(start.slice(0, 4))); y <= Number(end.slice(0, 4)); y++) {
      const occ = `${y}-${md}`;
      if (occ >= start && occ <= end) return true;
    }
    return false;
  };

  // Upcoming first (soonest on top); passed one-time holidays sink to the
  // bottom as disabled rows, most recent first. Recurring holidays never
  // count as passed — they roll to next year.
  const todayIso = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const hasPassed = (h: PublicHoliday) => h.date.slice(0, 10) < todayIso && !h.is_recurring;

  // While an ACTIVE (not passed) holiday is the headline, posting is closed:
  // no other row offers the icon. A pinned holiday whose date passes frees the
  // slot automatically — otherwise one stale pin would lock the feature.
  // Checked against the UNfiltered list so a pin outside the current period
  // filter still counts as occupying the slot.
  const anyActivePinned = (holidays ?? []).some((h) => h.is_pinned && !hasPassed(h));

  const sortedHolidays = (holidays ?? []).filter(inPeriod).sort((a, b) => {
    const pa = hasPassed(a), pb = hasPassed(b);
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });

  return (
    <>
      {/* Header: announcement framing + add action */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground min-w-0 flex-1">
          Holidays announced here appear on every employee&apos;s My Leave page and
          the team calendar, and are excluded from leave day counts.
        </p>
        <Button size="sm" className="h-8 text-xs shrink-0" onClick={openAddHoliday}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Announce Holiday
        </Button>
      </div>

      {(
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b border-border/50">
              <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
                Public Holidays ({sortedHolidays.length})
              </p>
            </div>
            {holidaysLoading ? (
              <div className="px-4 py-6">
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                </div>
              </div>
            ) : sortedHolidays.length === 0 ? (
              <div className="py-10 text-center">
                <CalendarDays className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                {period.kind !== 'all' && (holidays?.length ?? 0) > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground font-medium">No holidays in this period</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Clear the period filter to see all holidays</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground font-medium">No public holidays configured</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Add holidays to exclude them from working day counts</p>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap">Holiday</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap">Date</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap">Day</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap">Type</th>
                      {/* w-px collapses the column to its content so the slack
                          goes to Type instead — header and buttons then sit
                          together, tight against the right edge. */}
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground pl-4 pr-4 py-2 whitespace-nowrap text-right w-px">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHolidays.map((holiday) => {
                      const isPast = hasPassed(holiday);
                      return (
                        <tr
                          key={holiday.id}
                          aria-disabled={isPast || undefined}
                          // Passed rows read as disabled: dimmed, muted ground,
                          // struck-through name, no hover response. The Delete
                          // button stays live — it is the only way to clean old
                          // rows out.
                          className={cn(
                            'border-b border-border/30 last:border-0',
                            isPast && 'opacity-45 bg-muted/40 select-none',
                          )}
                        >
                          <td className={cn('px-4 py-2 whitespace-nowrap text-[0.75rem] font-medium', isPast && 'line-through text-muted-foreground')}>
                            {holiday.name}
                            {isPast && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[0.55rem] font-medium text-muted-foreground no-underline align-middle">
                                Passed
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-[0.75rem] text-muted-foreground">{formatDate(holiday.date)}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                            {new Date(holiday.date).toLocaleDateString('en-US', { weekday: 'long' })}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {holiday.is_recurring ? (
                              <span className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                                <Repeat className="h-3 w-3" /> Yearly
                              </span>
                            ) : (
                              <span className="text-[0.65rem] text-muted-foreground">One-time</span>
                            )}
                          </td>
                          <td className="pl-4 pr-4 py-2 whitespace-nowrap text-right w-px">
                            {/* Post to headline. Every FUTURE holiday that is
                                the headline shows a STATIC chip — posting is
                                closed while one headline is live, so no other
                                row offers the icon either. Passed rows show
                                neither: a finished holiday cannot be news. */}
                            {holiday.is_pinned && !isPast ? (
                              <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6rem] font-medium text-primary align-middle">
                                <Megaphone className="h-3 w-3" />
                                Headline
                              </span>
                            ) : !isPast && !anyActivePinned ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-muted-foreground hover:text-foreground"
                                title="Post as headline"
                                aria-label={`Post ${holiday.name} as headline`}
                                onClick={() => pinHolidayMutation.mutate(holiday)}
                                disabled={pinHolidayMutation.isPending}
                              >
                                <Megaphone className="h-3 w-3" />
                              </Button>
                            ) : null}
                            {/* Edit stays available on PASSED holidays too —
                                fixing a wrong date is exactly how a mistake
                                gets corrected after the fact. */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-muted-foreground hover:text-foreground"
                              title="Edit holiday"
                              aria-label={`Edit ${holiday.name}`}
                              onClick={() => openEditHoliday(holiday)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(holiday)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Announce / Edit Holiday Dialog — one dialog for both so the fields
          can never drift apart. */}
      <Dialog open={showAddDialog} onOpenChange={(o) => { setShowAddDialog(o); if (!o) setEditingHoliday(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editingHoliday ? 'Edit Public Holiday' : 'Announce Public Holiday'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {editingHoliday
                ? 'Changes apply everywhere this holiday appears — the headline, employee pages and leave day counts.'
                : 'This holiday will be excluded from working day counts when employees apply for leave.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3">
            <div className="grid gap-1.5">
              <Label htmlFor="holiday-name" className="text-xs">Holiday Name</Label>
              <Input id="holiday-name" placeholder="e.g. Independence Day" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="holiday-date" className="text-xs">Date</Label>
              <Input id="holiday-date" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <Switch checked={holidayRecurring} onCheckedChange={setHolidayRecurring} id="holiday-recurring" />
              <Label htmlFor="holiday-recurring" className="text-xs cursor-pointer">Repeats every year</Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowAddDialog(false); setEditingHoliday(null); }}>Cancel</Button>
            <Button size="sm" onClick={handleSaveHoliday} disabled={!holidayName.trim() || !holidayDate || holidaySaving}>
              {holidaySaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {editingHoliday ? 'Save Changes' : 'Announce Holiday'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Holiday Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Remove Public Holiday</DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to remove &ldquo;{deleteTarget?.name}&rdquo; ({formatDate(deleteTarget?.date)})?
              This will affect future leave day calculations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => deleteTarget && deleteHolidayMutation.mutate(deleteTarget.id)} disabled={deleteHolidayMutation.isPending}>
              {deleteHolidayMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Leave Types Tab ─────────────────────────────────────────────────────────

function LeaveTypesTab() {
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingType, setEditingType] = useState<LeaveType | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('edit');

  const { data: leaveTypes, isLoading, isError } = useLeaveTypes();

  const form = useForm<LeaveTypeFormData>({
    resolver: zodResolver(leaveTypeFormSchema) as any,
    defaultValues: { name: '', code: '', type: 'paid', days_per_year: 0, accrual_method: 'annual', max_carry_over: 0, is_active: true },
  });

  // Leave types use the lowercase slug format (Annual Leave -> annual), unlike
  // departments/positions which use uppercase abbreviations. Suggested for new
  // types only — an existing code may already be referenced by leave requests.
  useCodeFromName({
    form,
    sourceField: 'name',
    codeField: 'code',
    generate: slugCode,
    enabled: !editingType,
  });

  const createMutation = useMutation({
    mutationFn: (data: LeaveTypeFormData) => api.post('/hr/leave-types', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] });
      toast.success('Leave type created');
      closeSheet();
    },
    onError: (error: unknown) => {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Failed to create leave type');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: LeaveTypeFormData & { id: string }) => api.put(`/hr/leave-types/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] });
      toast.success('Leave type updated');
      // Return to the view pane rather than closing, so the user sees the saved
      // result and dismisses the modal themselves via the cross icon.
      setMode('view');
    },
    onError: (error: unknown) => {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Failed to update leave type');
    },
  });

  const openCreate = () => {
    setEditingType(null);
    setMode('edit');
    form.reset({ name: '', code: '', type: 'paid', days_per_year: 0, accrual_method: 'annual', max_carry_over: 0, is_active: true });
    setSheetOpen(true);
  };

  const fillForm = (lt: LeaveType) => {
    form.reset({ name: lt.name, code: lt.code, type: lt.type, days_per_year: lt.days_per_year, accrual_method: lt.accrual_method, max_carry_over: lt.max_carry_over, is_active: lt.is_active });
  };

  const openEdit = (lt: LeaveType) => {
    setEditingType(lt);
    setMode('edit');
    fillForm(lt);
    setSheetOpen(true);
  };

  /** Row click — read-only pane first, Edit switches to the form. */
  const openView = (lt: LeaveType) => {
    setEditingType(lt);
    setMode('view');
    fillForm(lt);
    setSheetOpen(true);
  };

  const closeSheet = () => { setSheetOpen(false); setEditingType(null); setMode('edit'); form.reset(); };

  const handleSubmit = form.handleSubmit((data: LeaveTypeFormData) => {
    if (editingType) updateMutation.mutate({ ...data, id: editingType.id });
    else createMutation.mutate(data);
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  // `editingType` is the snapshot taken when the row was clicked. After a save
  // the view pane must show the SAVED values, so re-resolve it from the
  // refetched list by id; fall back to the snapshot if it is not there.
  const activeType = editingType
    ? ((leaveTypes ?? []).find((lt) => lt.id === editingType.id) ?? editingType)
    : null;

  return (
    <>
      {/* Add button */}
      <div className="flex justify-end">
        <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Leave Type
        </Button>
      </div>

      {/* Table */}
      {isError ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <Settings className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load leave types</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : !leaveTypes || leaveTypes.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Settings className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No leave types configured</p>
              <p className="text-xs text-muted-foreground">Add your first leave type to get started.</p>
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
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Name</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Code</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Type</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-center">Days/Year</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Accrual</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-center">Carryover</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveTypes.map((lt) => (
                    <tr
                      key={lt.id}
                      onClick={() => openView(lt)}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-[0.75rem] font-medium">{lt.name}</span>
                          {!lt.is_active && (
                            <span className="inline-flex items-center gap-1 text-[0.6rem] text-muted-foreground">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                              Inactive
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.6rem] font-semibold font-mono', codeBadgeColor(lt.code))}>
                          {lt.code}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-[0.7rem] font-medium',
                          lt.type === 'paid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                        )}>
                          <span className={cn('inline-block w-1.5 h-1.5 rounded-full', lt.type === 'paid' ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                          {lt.type === 'paid' ? 'Paid' : 'Unpaid'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center text-[0.75rem] font-semibold tabular-nums">{lt.days_per_year}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground capitalize">{lt.accrual_method}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center text-[0.75rem] tabular-nums">{lt.max_carry_over}</td>
                      {/* stopPropagation so the Edit button does not also fire
                          the row's view-modal click. */}
                      <td className="px-4 py-2.5 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-6 px-2.5 text-[0.6rem]" onClick={() => openEdit(lt)}>
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog — compact centred dialog matching the department
          form, not a full-height side sheet. Fields pair two-up so the form
          reads at a glance instead of stretching down a tall panel. */}
      <Dialog open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === 'view' && activeType
                ? activeType.name
                : editingType ? 'Edit Leave Type' : 'New Leave Type'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'view'
                ? 'Leave type details'
                : editingType ? 'Update the details for this leave type.' : 'Configure a new leave type for your organization.'}
            </DialogDescription>
          </DialogHeader>

          {mode === 'view' && activeType ? (
            <LeaveTypeView type={activeType} onEdit={() => setMode('edit')} />
          ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-name" className="text-xs">Name</Label>
                <Input id="lt-name" placeholder="e.g. Annual Leave" {...form.register('name')} aria-invalid={!!form.formState.errors.name} className="h-8 text-sm" />
                {form.formState.errors.name && <p className="text-[0.65rem] text-destructive">{form.formState.errors.name.message}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-code" className="text-xs">Code</Label>
                <Input id="lt-code" placeholder="e.g. annual" {...form.register('code')} aria-invalid={!!form.formState.errors.code} className="h-8 text-sm" />
                {form.formState.errors.code && <p className="text-[0.65rem] text-destructive">{form.formState.errors.code.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Type</Label>
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full h-8 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-days" className="text-xs">Days Per Year</Label>
                <Input id="lt-days" type="number" min="0" max="365" {...form.register('days_per_year')} className="h-8 text-sm" />
                {form.formState.errors.days_per_year && <p className="text-[0.65rem] text-destructive">{form.formState.errors.days_per_year.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Accrual Method</Label>
                <Controller
                  control={form.control}
                  name="accrual_method"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full h-8 text-sm"><SelectValue placeholder="Select method" /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="annual">Annual (all at once)</SelectItem>
                          <SelectItem value="monthly">Monthly (accrue each month)</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-carryover" className="text-xs">Max Carry Over (days)</Label>
                <Input id="lt-carryover" type="number" min="0" max="365" {...form.register('max_carry_over')} className="h-8 text-sm" />
                {form.formState.errors.max_carry_over && <p className="text-[0.65rem] text-destructive">{form.formState.errors.max_carry_over.message}</p>}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="lt-active" className="text-xs">Active</Label>
                <p className="text-[0.65rem] text-muted-foreground">Inactive types cannot be used for new requests</p>
              </div>
              <Controller
                control={form.control}
                name="is_active"
                render={({ field }) => <Switch id="lt-active" checked={field.value} onCheckedChange={field.onChange} />}
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                // Cancelling an edit on an existing type returns to the view
                // pane; cancelling a create closes outright.
                onClick={() => (editingType ? setMode('view') : closeSheet())}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin mr-1.5 h-3.5 w-3.5" />}
                {editingType ? 'Save Changes' : 'Create Type'}
              </Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Leave type view pane (read-only detail + Edit button) ───────────────────

function LeaveTypeDetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground shrink-0 pt-0.5">
        {label}
      </span>
      <div className="text-xs text-foreground text-right min-w-0">{children}</div>
    </div>
  );
}

const ACCRUAL_LABELS: Record<string, string> = {
  annual: 'Annual (all at once)',
  monthly: 'Monthly (accrue each month)',
  none: 'None',
};

function LeaveTypeView({ type, onEdit }: { type: LeaveType; onEdit: () => void }) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col">
        <LeaveTypeDetailRow label="Code">
          {/* Same helper the listing uses, so a code keeps its colour when the
              row is opened. */}
          <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.6rem] font-semibold font-mono', codeBadgeColor(type.code))}>
            {type.code}
          </span>
        </LeaveTypeDetailRow>

        <LeaveTypeDetailRow label="Type">
          <span className="capitalize">{type.type}</span>
        </LeaveTypeDetailRow>

        <LeaveTypeDetailRow label="Days Per Year">
          <span className="tabular-nums font-medium">{type.days_per_year}</span>
        </LeaveTypeDetailRow>

        <LeaveTypeDetailRow label="Accrual">
          {ACCRUAL_LABELS[type.accrual_method] ?? type.accrual_method}
        </LeaveTypeDetailRow>

        <LeaveTypeDetailRow label="Max Carry Over">
          <span className="tabular-nums">{type.max_carry_over} days</span>
        </LeaveTypeDetailRow>

        <LeaveTypeDetailRow label="Status">
          {type.is_active ? (
            <span className="inline-flex items-center gap-1 text-[0.65rem] text-emerald-600 dark:text-emerald-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
              Inactive
            </span>
          )}
        </LeaveTypeDetailRow>
      </div>

      <DialogFooter className="pt-4">
        <Button type="button" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit
        </Button>
      </DialogFooter>
    </div>
  );
}
