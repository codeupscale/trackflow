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
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
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

type Tab = 'approvals' | 'calendar' | 'types';

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
      {activeTab === 'approvals' && canApprove && <ApprovalsTab />}
      {activeTab === 'calendar' && canViewCalendar && (
        <CalendarTab isAdmin={canManageHolidays} />
      )}
      {activeTab === 'types' && canManageTypes && <LeaveTypesTab />}
    </div>
  );
}

// ─── Approvals Tab ───────────────────────────────────────────────────────────

function ApprovalsTab() {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [currentPage, setCurrentPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);

  const { data, isLoading, isError } = useLeaveRequests({
    status: statusFilter,
    page: currentPage,
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
    const pendingRequests = requests.filter((r) => r.status === 'pending');
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

      {/* Approve All + Filter */}
      <div className="flex items-center justify-between">
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
            className="h-7 text-[0.65rem]"
            onClick={handleBulkApprove}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <CheckCheck className="h-3 w-3 mr-1" />
            )}
            Approve All ({requests.filter((r) => r.status === 'pending').length})
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
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-16" />
                ))}
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="h-7 w-7 rounded-full" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-5 w-14" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
                        <tr key={req.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
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
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            {req.status === 'pending' ? (
                              <div className="inline-flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => approveMutation.mutate(req.id)}
                                  disabled={approveMutation.isPending}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] text-destructive hover:text-destructive"
                                  onClick={() => { setRejectTarget(req); rejectForm.reset(); }}
                                  disabled={rejectMutation.isPending}
                                >
                                  Reject
                                </Button>
                              </div>
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
}

function CalendarTab({ isAdmin }: { isAdmin: boolean }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const queryClient = useQueryClient();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayRecurring, setHolidayRecurring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PublicHoliday | null>(null);

  const { data: holidays, isLoading: holidaysLoading } = useQuery<PublicHoliday[]>({
    queryKey: ['public-holidays'],
    queryFn: async () => {
      const res = await api.get('/hr/public-holidays');
      const raw = res.data;
      return raw.data ?? raw.holidays ?? (Array.isArray(raw) ? raw : []);
    },
    enabled: isAdmin,
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
    onError: () => toast.error('Failed to add holiday'),
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

  const handleAddHoliday = () => {
    if (!holidayName.trim() || !holidayDate) return;
    addHolidayMutation.mutate({ name: holidayName.trim(), date: holidayDate, is_recurring: holidayRecurring });
  };

  const sortedHolidays = (holidays ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <>
      {/* Add Holiday button */}
      {isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" className="h-8 text-xs" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Public Holiday
          </Button>
        </div>
      )}

      {/* Calendar */}
      <LeaveCalendar month={month} year={year} onMonthChange={(m, y) => { setMonth(m); setYear(y); }} />

      {/* Public Holidays List */}
      {isAdmin && (
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
                <p className="text-sm text-muted-foreground font-medium">No public holidays configured</p>
                <p className="text-xs text-muted-foreground mt-0.5">Add holidays to exclude them from working day counts</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap">Holiday</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap">Date</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap">Type</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2 whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHolidays.map((holiday) => {
                      const isPast = holiday.date < todayStr && !holiday.is_recurring;
                      return (
                        <tr key={holiday.id} className={cn('border-b border-border/30 last:border-0', isPast && 'opacity-50')}>
                          <td className="px-4 py-2 whitespace-nowrap text-[0.75rem] font-medium">{holiday.name}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-[0.75rem] text-muted-foreground">{formatDate(holiday.date)}</td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {holiday.is_recurring ? (
                              <span className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                                <Repeat className="h-3 w-3" /> Yearly
                              </span>
                            ) : (
                              <span className="text-[0.65rem] text-muted-foreground">One-time</span>
                            )}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-right">
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

      {/* Add Holiday Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Add Public Holiday</DialogTitle>
            <DialogDescription className="text-xs">
              This holiday will be excluded from working day counts when employees apply for leave.
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
            <Button variant="outline" size="sm" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAddHoliday} disabled={!holidayName.trim() || !holidayDate || addHolidayMutation.isPending}>
              {addHolidayMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Add Holiday
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

  const { data: leaveTypes, isLoading, isError } = useLeaveTypes();

  const form = useForm<LeaveTypeFormData>({
    resolver: zodResolver(leaveTypeFormSchema) as any,
    defaultValues: { name: '', code: '', type: 'paid', days_per_year: 0, accrual_method: 'annual', max_carry_over: 0, is_active: true },
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
      closeSheet();
    },
    onError: (error: unknown) => {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Failed to update leave type');
    },
  });

  const openCreate = () => {
    setEditingType(null);
    form.reset({ name: '', code: '', type: 'paid', days_per_year: 0, accrual_method: 'annual', max_carry_over: 0, is_active: true });
    setSheetOpen(true);
  };

  const openEdit = (lt: LeaveType) => {
    setEditingType(lt);
    form.reset({ name: lt.name, code: lt.code, type: lt.type, days_per_year: lt.days_per_year, accrual_method: lt.accrual_method, max_carry_over: lt.max_carry_over, is_active: lt.is_active });
    setSheetOpen(true);
  };

  const closeSheet = () => { setSheetOpen(false); setEditingType(null); form.reset(); };

  const handleSubmit = form.handleSubmit((data: LeaveTypeFormData) => {
    if (editingType) updateMutation.mutate({ ...data, id: editingType.id });
    else createMutation.mutate(data);
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

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
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          </CardContent>
        </Card>
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
                    <tr key={lt.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
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
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem]">{lt.code}</code>
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
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
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

      {/* Create/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editingType ? 'Edit Leave Type' : 'New Leave Type'}</SheetTitle>
            <SheetDescription>
              {editingType ? 'Update the details for this leave type.' : 'Configure a new leave type for your organization.'}
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-name" className="text-xs">Name</Label>
              <Input id="lt-name" placeholder="e.g., Annual Leave" {...form.register('name')} aria-invalid={!!form.formState.errors.name} className="h-8 text-sm" />
              {form.formState.errors.name && <p className="text-[0.65rem] text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-code" className="text-xs">Code</Label>
              <Input id="lt-code" placeholder="e.g., annual" {...form.register('code')} aria-invalid={!!form.formState.errors.code} className="h-8 text-sm" />
              {form.formState.errors.code && <p className="text-[0.65rem] text-destructive">{form.formState.errors.code.message}</p>}
            </div>
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
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Accrual Method</Label>
              <Controller
                control={form.control}
                name="accrual_method"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full h-8 text-sm"><SelectValue placeholder="Select accrual method" /></SelectTrigger>
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
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="lt-active" className="text-xs">Active</Label>
                <p className="text-[0.6rem] text-muted-foreground">Inactive types cannot be used for new requests</p>
              </div>
              <Controller
                control={form.control}
                name="is_active"
                render={({ field }) => <Switch id="lt-active" checked={field.value} onCheckedChange={field.onChange} />}
              />
            </div>
          </form>
          <SheetFooter>
            <Button variant="outline" onClick={closeSheet}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending && <Loader2 className="animate-spin mr-1.5 h-3.5 w-3.5" />}
              {editingType ? 'Save Changes' : 'Create Type'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
