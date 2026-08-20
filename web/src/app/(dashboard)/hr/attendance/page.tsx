'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  FileEdit,
  Loader2,
  Palmtree,
  Timer,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { CheckInCard } from '@/components/hr/CheckInCard';
import { CheckInStatusBadge, type CheckInBadgeStatus } from '@/components/hr/CheckInStatusBadge';
import { useAttendance, useAttendanceSummary, useRequestRegularization } from '@/hooks/hr/use-attendance';
import { useTodayStatus } from '@/hooks/hr/use-check-in';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { regularizationSchema, type RegularizationFormData, type AttendanceRecord } from '@/lib/validations/attendance';
import { cn, formatDate } from '@/lib/utils';
import {
  deriveCheckInBadges,
  formatDuration,
  formatMinutes,
  checkInBadgeTooltip,
} from '@/lib/check-in-time';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_FILTERS = ['all', 'present', 'absent', 'on_leave'] as const;

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  present: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Present' },
  absent: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Absent' },
  half_day: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Half Day' },
  on_leave: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', label: 'On Leave' },
  holiday: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Holiday' },
  weekend: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'Weekend' },
};

export default function MyAttendancePage() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [regularizeTarget, setRegularizeTarget] = useState<AttendanceRecord | null>(null);

  const dateFrom = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
  const dateTo = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: attendanceData, isLoading, isError } = useAttendance({
    start_date: dateFrom,
    end_date: dateTo,
    status: statusFilter,
    page: currentPage,
  });

  const { data: summary, isLoading: summaryLoading } = useAttendanceSummary(selectedMonth, selectedYear);
  const regularizeMutation = useRequestRegularization();
  const { hasPermission } = usePermissionStore();
  const { user } = useAuthStore();
  const canCheckIn = hasPermission('attendance.check_in');

  // Lateness is a management signal, not something a person is shown about themselves on
  // their own attendance page — the OWNER is the only role that may see it here. This
  // gates EVERY late surface on the page (the Late column, the Late badge on the status
  // cell, and the Late Days stat tile); hiding only one of the three leaks the same
  // number from the others, which is why the badge is included. Deliberately a ROLE
  // check, not `attendance.view_all` — that permission is held by org_manager,
  // hr_manager and finance_manager alike, none of whom may see it.
  const canSeeLate = user?.role === 'owner';

  // Present / Absent / [Late Days] / On Leave / Overtime. Whole class names so Tailwind
  // sees them at build time; the skeleton count matches so the strip does not reflow.
  const statCount = canSeeLate ? 5 : 4;
  const statGridCols = canSeeLate ? 'lg:grid-cols-5' : 'lg:grid-cols-4';

  const { data: todayStatus } = useTodayStatus({ enabled: canCheckIn });
  const policyCheckInTime = todayStatus?.policy?.check_in_time;
  const policyCheckoutTime = todayStatus?.policy?.checkout_time;

  const records = attendanceData?.data ?? [];
  const totalPages = attendanceData?.last_page ?? 1;
  const hasAnyShift = records.some((r) => Boolean(r.shift_name));

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RegularizationFormData>({
    resolver: zodResolver(regularizationSchema) as any,
  });

  const requestedStatus = watch('requested_status');

  const openRegularizeDialog = (record: AttendanceRecord) => {
    setRegularizeTarget(record);
    setValue('attendance_record_id', record.id);
    setValue('requested_status', 'present');
    setValue('reason', '');
  };

  const handleRegularize = (data: RegularizationFormData) => {
    regularizeMutation.mutate(data, {
      onSuccess: () => { setRegularizeTarget(null); reset(); },
    });
  };

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current, current - 1, current - 2];
  }, []);

  const canRegularize = (record: AttendanceRecord) => {
    return (
      !record.is_synthetic &&
      (record.status === 'absent' || record.status === 'half_day') &&
      !record.is_regularized &&
      record.regularization_status == null
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">My Attendance</h1>
          <p className="text-xs text-muted-foreground">
            View your attendance records and request corrections
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(selectedMonth)}
            onValueChange={(v) => { setSelectedMonth(Number(v)); setCurrentPage(1); }}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs" aria-label="Select month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {MONTHS.map((name, idx) => (
                  <SelectItem key={idx} value={String(idx + 1)}>{name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={String(selectedYear)}
            onValueChange={(v) => { setSelectedYear(Number(v)); setCurrentPage(1); }}
          >
            <SelectTrigger className="w-[80px] h-8 text-xs" aria-label="Select year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Check-in Card */}
      {canCheckIn && <CheckInCard className="sm:max-w-2xl" />}

      {/* Stats Strip */}
      {summaryLoading ? (
        <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-3', statGridCols)}>
          {Array.from({ length: statCount }).map((_, i) => (
            <Card key={i}><CardContent className="p-3"><Skeleton className="h-10" /></CardContent></Card>
          ))}
        </div>
      ) : summary ? (
        <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-3', statGridCols)}>
          {[
            { label: 'Present', value: summary.present_days, sub: `of ${summary.total_working_days}`, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            { label: 'Absent', value: summary.absent_days, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
            ...(canSeeLate
              ? [{ label: 'Late Days', value: summary.late_days, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' }]
              : []),
            { label: 'On Leave', value: summary.on_leave_days, icon: Palmtree, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { label: 'Overtime', value: `${Number(summary.overtime_hours).toFixed(1)}h`, icon: Timer, color: 'text-violet-500', bg: 'bg-violet-500/10' },
          ].map((s) => (
            <Card key={s.label} className="border-border">
              <CardContent className="p-3">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                    <div className="flex items-baseline gap-1">
                      <p className="text-base font-bold text-foreground tabular-nums leading-tight">{s.value}</p>
                      {s.sub && <span className="text-[0.55rem] text-muted-foreground">/ {s.sub.replace('of ', '')}</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {STATUS_FILTERS.map((status) => (
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
            {status === 'on_leave' ? 'On Leave' : status}
          </button>
        ))}
      </div>

      {/* Attendance Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <CalendarDays className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load attendance records</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-3 w-14" />)}
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-10" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3.5 w-12" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No attendance records found</p>
              <p className="text-xs text-muted-foreground">
                {statusFilter !== 'all' ? 'No records match the selected filter.' : 'Attendance records will appear here once generated.'}
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap w-[14%]">Date</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap w-[8%]">Day</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap w-[22%]">Status</th>
                      {hasAnyShift && <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap w-[14%]">Shift</th>}
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap w-[14%]">Clock In</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap w-[14%]">Clock Out</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right w-[14%]">Hours</th>
                      {canSeeLate && <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right w-[14%]">Late</th>}
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right w-[14%]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => {
                      const sd = statusDot[record.status] ?? statusDot.absent;
                      // The late badge carries the same signal as the Late column, so it
                      // rides the same gate — hiding the column alone would leak it here.
                      const checkInBadges = deriveCheckInBadges(record).filter(
                        (badge) => canSeeLate || badge !== 'late'
                      );
                      const secs =
                        record.worked_seconds != null
                          ? record.worked_seconds
                          : Number(record.total_hours) * 3600;

                      return (
                        <tr key={record.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] font-medium">{formatDate(record.date)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">{record.day}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                                {sd.label}
                              </span>
                              {checkInBadges.map((s) => (
                                <CheckInStatusBadge
                                  key={s}
                                  status={s as CheckInBadgeStatus}
                                  tooltip={checkInBadgeTooltip(s, {
                                    lateMinutes: record.late_minutes,
                                    checkInTime: policyCheckInTime,
                                    checkoutTime: policyCheckoutTime,
                                  })}
                                />
                              ))}
                            </div>
                          </td>
                          {hasAnyShift && (
                            <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                              {record.shift_name || <span className="text-muted-foreground/40">&mdash;</span>}
                            </td>
                          )}
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums">
                            {record.clock_in || <span className="text-muted-foreground/40">&mdash;</span>}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums">
                            {record.clock_out || <span className="text-muted-foreground/40">&mdash;</span>}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right text-[0.75rem] tabular-nums">
                            {secs > 0 ? formatDuration(secs) : <span className="text-muted-foreground/40">&mdash;</span>}
                          </td>
                          {canSeeLate && (
                            <td className="px-4 py-2.5 whitespace-nowrap text-right">
                              {record.late_minutes > 0 ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={<span />}
                                    className="cursor-help text-[0.75rem] tabular-nums text-amber-600 dark:text-amber-400 font-medium"
                                    tabIndex={0}
                                  >
                                    {formatMinutes(record.late_minutes)}
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {checkInBadgeTooltip('late', {
                                      lateMinutes: record.late_minutes,
                                      checkInTime: policyCheckInTime,
                                    })}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-[0.75rem] text-muted-foreground/40">&mdash;</span>
                              )}
                            </td>
                          )}
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            {canRegularize(record) ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2.5 text-[0.6rem]"
                                onClick={() => openRegularizeDialog(record)}
                                aria-label={`Request regularization for ${formatDate(record.date)}`}
                              >
                                <FileEdit className="h-3 w-3 mr-1" />
                                Regularize
                              </Button>
                            ) : record.regularization_status === 'pending' ? (
                              <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-medium text-amber-600 dark:text-amber-400">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Pending
                              </span>
                            ) : record.regularization_status === 'approved' ? (
                              <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-medium text-emerald-600 dark:text-emerald-400">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Regularized
                              </span>
                            ) : record.regularization_status === 'rejected' ? (
                              <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-medium text-red-600 dark:text-red-400">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                                Rejected
                              </span>
                            ) : (
                              <span className="text-[0.65rem] text-muted-foreground/40">&mdash;</span>
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

      {/* Regularization Dialog */}
      <Dialog
        open={!!regularizeTarget}
        onOpenChange={(open) => { if (!open) { setRegularizeTarget(null); reset(); } }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit(handleRegularize)}>
            <DialogHeader>
              <DialogTitle className="text-base">Request Regularization</DialogTitle>
              <DialogDescription className="text-xs">
                Request a correction for your attendance on{' '}
                <span className="font-medium text-foreground">{formatDate(regularizeTarget?.date)}</span>.
                Current status: {regularizeTarget?.status?.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" {...register('attendance_record_id')} />

            <div className="flex flex-col gap-3 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="requested_status" className="text-xs">Requested Status</Label>
                <Select
                  value={requestedStatus}
                  onValueChange={(v) => setValue('requested_status', v as 'present' | 'half_day')}
                >
                  <SelectTrigger className="h-8 text-sm" aria-label="Requested status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="present">Present</SelectItem>
                      <SelectItem value="half_day">Half Day</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {errors.requested_status && (
                  <p className="text-[0.65rem] text-destructive">{errors.requested_status.message}</p>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reason" className="text-xs">Reason</Label>
                <Textarea
                  id="reason"
                  rows={3}
                  placeholder="Explain why your attendance should be corrected..."
                  className="text-sm resize-none"
                  {...register('reason')}
                  aria-invalid={!!errors.reason}
                />
                {errors.reason && (
                  <p className="text-[0.65rem] text-destructive">{errors.reason.message}</p>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { setRegularizeTarget(null); reset(); }}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={regularizeMutation.isPending}>
                {regularizeMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
