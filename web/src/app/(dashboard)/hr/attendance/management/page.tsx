'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Clock,
  Download,
  FileBarChart2,
  FileEdit,
  Hourglass,
  Loader2,
  Search,
  Users,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TabLoading } from '@/components/ui/loader-3d';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DatePicker } from '@/components/ui/date-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import { EmployeeSelect } from '@/components/hr/EmployeeSelect';
import { CheckInStatusBadge, type CheckInBadgeStatus } from '@/components/hr/CheckInStatusBadge';
import {
  deriveCheckInBadges,
  formatDuration,
  formatMinutes,
  checkInBadgeTooltip,
} from '@/lib/check-in-time';
import { useTeamAttendance } from '@/hooks/hr/use-attendance';
import {
  useRegularizations,
  useApproveRegularization,
  useRejectRegularization,
} from '@/hooks/hr/use-regularizations';
import { useTodayStatus, useCheckInsSummary, exportCheckIns } from '@/hooks/hr/use-check-in';
import { PeriodFilter, periodToRange, type Period } from '@/components/common/PeriodFilter';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { cn, formatDate, formatDecimal } from '@/lib/utils';
import type { AttendanceRegularization } from '@/lib/validations/attendance';

// ─── Shared helpers ──────────────────────────────────────────────────────────

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  present: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Present' },
  absent: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Absent' },
  half_day: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Half Day' },
  on_leave: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', label: 'On Leave' },
  weekend: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'Weekend' },
  holiday: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Holiday' },
  pending: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Pending' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  rejected: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Rejected' },
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

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

type Tab = 'team' | 'regularizations' | 'report';

const rejectReviewSchema = z.object({
  review_note: z.string().min(1, 'Review note is required').max(500, 'Must be 500 characters or less'),
});
type RejectReviewFormData = z.infer<typeof rejectReviewSchema>;

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AttendanceManagementPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermissionWithScope, hasPermission } = usePermissionStore();

  const canViewTeam = hasPermissionWithScope('attendance.view', 'project');
  const canApproveRegularizations = hasPermission('attendance.approve_regularizations');
  const canViewAll = hasPermission('attendance.view_all');

  const hasAccess = canViewTeam || canApproveRegularizations || canViewAll;

  useEffect(() => {
    if (user && !hasAccess) {
      router.push('/hr/attendance');
    }
  }, [user, hasAccess, router]);

  const defaultTab: Tab = canViewTeam ? 'team' : canApproveRegularizations ? 'regularizations' : 'report';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  if (!user || !hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof UsersRound; show: boolean }[] = [
    { key: 'team', label: 'Team', icon: UsersRound, show: canViewTeam },
    { key: 'regularizations', label: 'Regularizations', icon: FileEdit, show: canApproveRegularizations },
    { key: 'report', label: 'Check-in Report', icon: FileBarChart2, show: canViewAll },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Attendance Management</h1>
        <p className="text-xs text-muted-foreground">
          Manage team attendance, regularizations, and check-in reports
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
      {activeTab === 'team' && canViewTeam && <TeamTab />}
      {activeTab === 'regularizations' && canApproveRegularizations && <RegularizationsTab />}
      {activeTab === 'report' && canViewAll && <ReportTab />}
    </div>
  );
}

// ─── Team Tab ───────────────────────────────────────────────────────────────

function TeamTab() {
  const { hasPermission } = usePermissionStore();
  const canCheckIn = hasPermission('attendance.check_in');
  const { data: todayStatus } = useTodayStatus({ enabled: canCheckIn });
  const policyCheckInTime = todayStatus?.policy?.check_in_time;

  const [departmentId, setDepartmentId] = useState<string | null>(null);
  // Empty by default — no date is pre-selected, so the list opens unfiltered
  // rather than silently pinned to the current month.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setCurrentPage(1);
    }, 300);
  };

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearch('');
    setDebouncedSearch('');
    setCurrentPage(1);
  };

  const { data, isLoading, isError } = useTeamAttendance({
    department_id: departmentId,
    search: debouncedSearch || undefined,
    start_date: dateFrom || undefined,
    end_date: dateTo || undefined,
    page: currentPage,
  });

  const records = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;
  const total = data?.total ?? 0;

  // Server-side counts spanning the whole filtered set. Counting `records`
  // instead would describe only the current page while `Total` describes all of
  // them — "Total 200 / Present 0 / Absent 9" on page 1 of 8. Falls back to the
  // page counts so the strip still renders against an older API build.
  const presentCount = data?.stats?.present ?? records.filter((r) => r.status === 'present').length;
  const absentCount = data?.stats?.absent ?? records.filter((r) => r.status === 'absent').length;
  const lateCount = data?.stats?.late ?? records.filter((r) => (r.check_in_late_minutes ?? 0) > 0).length;

  return (
    <>
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1 w-full sm:w-[220px]">
          <Label className="text-[0.65rem] text-muted-foreground">Employee</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="Search name or email..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-8 text-xs pl-8 pr-8"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearSearch}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 size-7 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 w-full sm:w-[180px]">
          <Label className="text-[0.65rem] text-muted-foreground">Department</Label>
          <DepartmentSelect
            value={departmentId}
            onChange={(val) => { setDepartmentId(val); setCurrentPage(1); }}
            placeholder="All departments"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[0.65rem] text-muted-foreground">From</Label>
          <Input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => { setDateFrom(e.target.value); if (dateTo && e.target.value > dateTo) setDateTo(e.target.value); setCurrentPage(1); }}
            className="h-8 text-xs w-[140px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[0.65rem] text-muted-foreground">To</Label>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
            className="h-8 text-xs w-[140px]"
          />
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: total, icon: CalendarDays, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Present', value: presentCount, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Absent', value: absentCount, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Late', value: lateCount, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
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

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <Users className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load team attendance</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Users className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                {debouncedSearch ? `No employees match "${debouncedSearch}"` : 'No attendance records found'}
              </p>
              <p className="text-xs text-muted-foreground">Adjust your filters or date range to view records.</p>
              {debouncedSearch && (
                <Button variant="outline" size="sm" onClick={clearSearch} className="mt-2 h-7 text-xs">
                  Clear search
                </Button>
              )}
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Date</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Clock In</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Clock Out</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Hours</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Late</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Overtime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      const sd = statusDot[record.status] ?? statusDot.present;
                      const userName = record.user?.name || '—';
                      const secs = record.worked_seconds != null
                        ? record.worked_seconds
                        : Number(record.total_hours) * 3600;

                      return (
                        <tr key={record.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={record.user?.avatar_url || undefined} alt={userName} />
                                <AvatarFallback className={`${getAvatarColor(userName)} text-white text-[0.5rem] font-medium`}>
                                  {getInitials(userName)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-[0.75rem] font-medium truncate">{userName}</p>
                                <p className="text-[0.6rem] text-muted-foreground truncate">{record.user?.email || ''}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                            {formatDate(record.date)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                                {sd.label}
                              </span>
                              {deriveCheckInBadges(record).map((s) => (
                                <CheckInStatusBadge key={s} status={s as CheckInBadgeStatus} />
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums">
                            {record.clock_in || '—'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums">
                            {record.clock_out || '—'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                            {secs > 0 ? formatDuration(secs) : '—'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                            {(record.check_in_late_minutes ?? 0) > 0 ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={<span />}
                                  className="cursor-help text-amber-600 dark:text-amber-400"
                                  tabIndex={0}
                                >
                                  {formatMinutes(record.check_in_late_minutes)}
                                </TooltipTrigger>
                                <TooltipContent>
                                  {checkInBadgeTooltip('late', {
                                    lateMinutes: record.check_in_late_minutes,
                                    checkInTime: policyCheckInTime,
                                  })}
                                </TooltipContent>
                              </Tooltip>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                            {Number(record.overtime_hours) > 0 ? (
                              <span className="text-violet-600 dark:text-violet-400">
                                {formatDecimal(record.overtime_hours)}h
                              </span>
                            ) : '—'}
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
    </>
  );
}

// ─── Regularizations Tab ────────────────────────────────────────────────────

const REG_STATUS_FILTERS = ['pending', 'approved', 'rejected'] as const;

function RegularizationsTab() {
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [currentPage, setCurrentPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<AttendanceRegularization | null>(null);

  const { data, isLoading, isError } = useRegularizations({
    status: statusFilter,
    page: currentPage,
  });

  const approveMutation = useApproveRegularization();
  const rejectMutation = useRejectRegularization();

  const rejectForm = useForm<RejectReviewFormData>({
    resolver: zodResolver(rejectReviewSchema) as any,
  });

  const regularizations = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;
  const totalCount = data?.total ?? 0;

  const pendingOnPage = regularizations.filter((r) => r.status === 'pending').length;
  const approvedOnPage = regularizations.filter((r) => r.status === 'approved').length;
  const rejectedOnPage = regularizations.filter((r) => r.status === 'rejected').length;

  const handleApprove = (id: string) => approveMutation.mutate(id);

  const handleRejectSubmit = (formData: RejectReviewFormData) => {
    if (!rejectTarget) return;
    rejectMutation.mutate(
      { id: rejectTarget.id, review_note: formData.review_note },
      { onSuccess: () => { setRejectTarget(null); rejectForm.reset(); } },
    );
  };

  const handleBulkApprove = async () => {
    const pending = regularizations.filter((r) => r.status === 'pending');
    for (const reg of pending) {
      await approveMutation.mutateAsync(reg.id);
    }
  };

  return (
    <>
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: totalCount, icon: FileEdit, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Pending', value: statusFilter === 'pending' ? totalCount : pendingOnPage, icon: Hourglass, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Approved', value: approvedOnPage, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Rejected', value: rejectedOnPage, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
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

      {/* Filter + Bulk Approve */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {REG_STATUS_FILTERS.map((status) => (
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
        {statusFilter === 'pending' && pendingOnPage > 1 && (
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
            Approve All ({pendingOnPage})
          </Button>
        )}
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <FileEdit className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load requests</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : regularizations.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <FileEdit className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                No {statusFilter} regularization requests
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Date</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Change</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Reason</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regularizations.map((reg) => {
                      const sd = statusDot[reg.status] ?? statusDot.pending;
                      const currentSd = statusDot[reg.current_status] ?? statusDot.absent;
                      const requestedSd = statusDot[reg.requested_status] ?? statusDot.present;

                      return (
                        <tr key={reg.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={reg.user.avatar_url || undefined} alt={reg.user.name} />
                                <AvatarFallback className={`${getAvatarColor(reg.user.name)} text-white text-[0.5rem] font-medium`}>
                                  {getInitials(reg.user.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-[0.75rem] font-medium truncate">{reg.user.name}</p>
                                <p className="text-[0.6rem] text-muted-foreground truncate">{reg.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                            {formatDate(reg.attendance_record.date)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <span className={`inline-flex items-center gap-1 text-[0.65rem] font-medium ${currentSd.text}`}>
                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${currentSd.dot}`} />
                                {currentSd.label}
                              </span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                              <span className={`inline-flex items-center gap-1 text-[0.65rem] font-medium ${requestedSd.text}`}>
                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${requestedSd.dot}`} />
                                {requestedSd.label}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 max-w-[200px]">
                            <Tooltip>
                              <TooltipTrigger
                                render={<span />}
                                className="text-[0.7rem] text-muted-foreground truncate block cursor-help"
                                tabIndex={0}
                              >
                                {reg.reason}
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="text-xs">{reg.reason}</p>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                              {sd.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            {reg.status === 'pending' ? (
                              <div className="inline-flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => handleApprove(reg.id)}
                                  disabled={approveMutation.isPending}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] text-destructive hover:text-destructive"
                                  onClick={() => { setRejectTarget(reg); rejectForm.reset(); }}
                                  disabled={rejectMutation.isPending}
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : reg.reviewer ? (
                              <span className="text-[0.6rem] text-muted-foreground">
                                by {reg.reviewer.name}
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

      {/* Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); rejectForm.reset(); } }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={rejectForm.handleSubmit(handleRejectSubmit)}>
            <DialogHeader>
              <DialogTitle className="text-base">Reject Regularization</DialogTitle>
              <DialogDescription className="text-xs">
                Please provide a reason for rejecting{' '}
                <span className="font-medium text-foreground">{rejectTarget?.user.name}</span>&apos;s
                request for <span className="font-medium text-foreground">{formatDate(rejectTarget?.attendance_record.date)}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 grid gap-1.5">
              <Label htmlFor="review_note" className="text-xs">Review Note</Label>
              <Textarea
                id="review_note"
                rows={3}
                placeholder="Enter the reason for rejection..."
                className="text-sm resize-none"
                {...rejectForm.register('review_note')}
                aria-invalid={!!rejectForm.formState.errors.review_note}
              />
              {rejectForm.formState.errors.review_note && (
                <p className="text-[0.65rem] text-destructive">{rejectForm.formState.errors.review_note.message}</p>
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

// ─── Report Tab ─────────────────────────────────────────────────────────────

/** Which control drives the report window: a single day, or a period range. */
type ViewMode = 'day' | 'range';

function ReportTab() {
  const { hasPermission } = usePermissionStore();
  const canExport = hasPermission('attendance.export');

  // Nothing is pre-filtered: neither the day picker nor the period filter
  // carries a default, so the report opens on every record.
  const [mode, setMode] = useState<ViewMode>('range');
  const [day, setDay] = useState('');
  // Same period control as Leave Management, replacing the old month + year
  // Selects. The API's period=range branch backs the presets a single 'month'
  // string could not express (quarter, year).
  const [period, setPeriod] = useState<Period>({ kind: 'all' });
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState<string | null>(null);
  const [exportingView, setExportingView] = useState<'detail' | 'summary' | null>(null);
  const [showBelowTargetOnly, setShowBelowTargetOnly] = useState(false);

  const range = useMemo(() => periodToRange(period), [period]);
  // Unfiltered when no day is picked, or when the period is "All time" (no
  // bounds) — send period=all so the server drops the date filter entirely
  // rather than falling back to a default window.
  const isAllTime = mode === 'day' ? !day : (!range.start_date || !range.end_date);

  const summaryFilters = useMemo(
    () =>
      isAllTime
        ? { period: 'all' as const, user_id: userId, page }
        : mode === 'day'
          ? { period: 'day' as const, date: day, user_id: userId, page }
          : {
              period: 'range' as const,
              start_date: range.start_date,
              end_date: range.end_date,
              user_id: userId,
              page,
            },
    [mode, day, isAllTime, range.start_date, range.end_date, userId, page],
  );

  const { data, isLoading, isError } = useCheckInsSummary(summaryFilters);
  const allRows = data?.data ?? [];
  // "Below target" narrows to employees who missed the requirement on at least
  // one present day — the question management actually opens this report to ask.
  // Filtered client-side over the current page: the API paginates, so a
  // server-side flag would be the honest fix if orgs outgrow one page.
  const rows = showBelowTargetOnly
    ? allRows.filter((r) => r.completion_rate !== null && r.completion_rate < 100)
    : allRows;
  const totalPages = data?.last_page ?? 1;

  const belowTargetCount = allRows.filter(
    (r) => r.completion_rate !== null && r.completion_rate < 100,
  ).length;

  const totalEmployees = rows.length;
  const totalLate = rows.reduce((sum, r) => sum + (r.late_count || 0), 0);
  const totalMissing = rows.reduce((sum, r) => sum + (r.missing_checkout_count || 0), 0);
  const totalWorkedSecs = rows.reduce((sum, r) => sum + (r.total_worked_seconds || 0), 0);

  const handleExport = async (view: 'detail' | 'summary') => {
    setExportingView(view);
    try {
      await exportCheckIns(
        isAllTime
          ? { period: 'all', user_id: userId, view }
          : mode === 'day'
            ? { period: 'day', date: day, user_id: userId, view }
            : {
                period: 'range',
                start_date: range.start_date,
                end_date: range.end_date,
                user_id: userId,
                view,
              },
      );
    } catch {
      // toast already surfaced by exportCheckIns
    } finally {
      setExportingView(null);
    }
  };

  return (
    <>
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1">
            <Label className="text-[0.65rem] text-muted-foreground">View</Label>
            <ToggleGroup
              value={[mode]}
              onValueChange={(val) => {
                const v = val[0];
                if (v === 'day' || v === 'range') { setMode(v); setPage(1); }
              }}
              variant="outline"
              className="h-8"
            >
              <ToggleGroupItem value="day" className="text-xs h-8 px-3">Day</ToggleGroupItem>
              <ToggleGroupItem value="range" className="text-xs h-8 px-3">Range</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {mode === 'day' ? (
            <div className="flex flex-col gap-1">
              <Label className="text-[0.65rem] text-muted-foreground">Date</Label>
              <DatePicker
                value={day}
                placeholder="All dates"
                clearable
                onChange={(v) => { setDay(v); setPage(1); }}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Label className="text-[0.65rem] text-muted-foreground">Period</Label>
              <PeriodFilter
                value={period}
                onChange={(next) => { setPeriod(next); setPage(1); }}
              />
            </div>
          )}

          <div className="flex flex-col gap-1 w-full sm:w-[200px]">
            <Label className="text-[0.65rem] text-muted-foreground">Employee</Label>
            <EmployeeSelect
              value={userId}
              onChange={(val) => { setUserId(val); setPage(1); }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[0.65rem] text-muted-foreground">Completion</Label>
            <Button
              type="button"
              variant={showBelowTargetOnly ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              aria-pressed={showBelowTargetOnly}
              onClick={() => setShowBelowTargetOnly((v) => !v)}
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Below target
              {belowTargetCount > 0 && (
                <span className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums',
                  showBelowTargetOnly ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
                )}>
                  {belowTargetCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {canExport && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={exportingView !== null}
              onClick={() => handleExport('summary')}
            >
              {exportingView === 'summary' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              Summary
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={exportingView !== null}
              onClick={() => handleExport('detail')}
            >
              {exportingView === 'detail' ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              Detail
            </Button>
          </div>
        )}
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Employees', value: totalEmployees, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Total Hours', value: totalWorkedSecs > 0 ? formatDuration(totalWorkedSecs) : '0h', icon: Clock, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Late', value: totalLate, icon: Hourglass, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Missing Checkout', value: totalMissing, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
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

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <CalendarDays className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load check-in report</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-16" />
              ))}
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-12" />
                <Skeleton className="h-3.5 w-12" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No check-ins in this period</p>
              <p className="text-xs text-muted-foreground">
                No employees checked in for the selected {mode === 'day' ? 'day' : 'period'}.
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Total</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Days</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Full Days</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Late</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Early</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.user.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarFallback className={`${getAvatarColor(row.user.name)} text-white text-[0.5rem] font-medium`}>
                                {getInitials(row.user.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-[0.75rem] font-medium truncate">{row.user.name}</p>
                              <p className="text-[0.6rem] text-muted-foreground truncate">{row.user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] font-semibold tabular-nums text-right">
                          {formatDuration(row.total_worked_seconds)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                          {row.days_present}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                          {row.completion_rate === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="inline-flex items-baseline gap-1.5">
                              <span className="font-medium">
                                {row.full_days_count}/{row.days_present}
                              </span>
                              <span
                                className={cn(
                                  'text-[0.65rem] font-semibold',
                                  row.completion_rate === 100
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : row.completion_rate >= 80
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-red-600 dark:text-red-400',
                                )}
                              >
                                {row.completion_rate}%
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                          {row.late_count > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400">{row.late_count}</span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                          {row.early_checkout_count > 0 ? (
                            <span className="text-orange-600 dark:text-orange-400">{row.early_checkout_count}</span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-right">
                          {row.missing_checkout_count > 0 ? (
                            <span className="text-red-600 dark:text-red-400">{row.missing_checkout_count}</span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[0.65rem] text-muted-foreground">Page {page} of {totalPages}</p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-disabled={page === 1}
                      className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
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
                          <PaginationLink isActive={p === page} onClick={() => setPage(p)} className="cursor-pointer">
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={page === totalPages}
                      className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}
    </>
  );
}
