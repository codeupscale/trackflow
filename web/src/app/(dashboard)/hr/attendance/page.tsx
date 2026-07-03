'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CheckCircle2,
  XCircle,
  Clock,
  CalendarDays,
  Palmtree,
  Timer,
  FileEdit,
  Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
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

import { AttendanceStatusBadge } from '@/components/hr/AttendanceStatusBadge';
import { AttendanceSummaryCard } from '@/components/hr/AttendanceSummaryCard';
import { CheckInCard } from '@/components/hr/CheckInCard';
import { CheckInStatusBadge, type CheckInBadgeStatus } from '@/components/hr/CheckInStatusBadge';
import { useAttendance, useAttendanceSummary, useRequestRegularization } from '@/hooks/hr/use-attendance';
import { useTodayStatus } from '@/hooks/hr/use-check-in';
import { usePermissionStore } from '@/stores/permission-store';
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

const STATUS_FILTERS = ['all', 'present', 'absent', 'half_day', 'on_leave'] as const;

export default function MyAttendancePage() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [regularizeTarget, setRegularizeTarget] = useState<AttendanceRecord | null>(null);

  // Compute date range from selected month/year
  const dateFrom = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
  const dateTo = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data: attendanceData, isLoading, isError } = useAttendance({
    start_date: dateFrom,
    end_date: dateTo,
    status: statusFilter,
    page: currentPage,
  });

  const { data: summary, isLoading: summaryLoading } = useAttendanceSummary(
    selectedMonth,
    selectedYear
  );

  const regularizeMutation = useRequestRegularization();
  const { hasPermission } = usePermissionStore();
  const canCheckIn = hasPermission('attendance.check_in');

  // Pull the org policy times (official start / checkout) so the late / early
  // tooltips can name a concrete anchor ("after the 11:30 AM official start").
  // The `today` endpoint requires `attendance.check_in`; gate the query on it and
  // fall back to generic phrasing when the policy isn't available. Shares the query
  // key with CheckInCard, so no extra request when both are on-screen.
  const { data: todayStatus } = useTodayStatus({ enabled: canCheckIn });
  const policyCheckInTime = todayStatus?.policy?.check_in_time;
  const policyCheckoutTime = todayStatus?.policy?.checkout_time;

  const records = attendanceData?.data ?? [];
  const totalPages = attendanceData?.last_page ?? 1;

  // Hide the Shift column entirely when NOT a single row in this result set carries
  // shift data — an all-"—" column is noise. Rendered with real names when any exists.
  const hasAnyShift = records.some((r) => Boolean(r.shift_name));
  const gridCols = hasAnyShift ? 'lg:grid-cols-9' : 'lg:grid-cols-8';

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
      onSuccess: () => {
        setRegularizeTarget(null);
        reset();
      },
    });
  };

  // Generate year options (current year and 2 previous)
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current, current - 1, current - 2];
  }, []);

  const canRegularize = (record: AttendanceRecord) => {
    return (
      (record.status === 'absent' || record.status === 'half_day') &&
      !record.is_regularized &&
      record.regularization_status == null
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Attendance</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View your attendance records and request corrections
          </p>
        </div>

        {/* Month/Year Picker */}
        <div className="flex items-center gap-2">
          <Select
            value={String(selectedMonth)}
            onValueChange={(v) => {
              setSelectedMonth(Number(v));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-[140px]" aria-label="Select month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {MONTHS.map((name, idx) => (
                  <SelectItem key={idx} value={String(idx + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={String(selectedYear)}
            onValueChange={(v) => {
              setSelectedYear(Number(v));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-[100px]" aria-label="Select year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Check-in / Checkout */}
      {canCheckIn && (
        <section aria-label="Check in and out">
          <CheckInCard className="sm:max-w-2xl" />
        </section>
      )}

      {/* Summary Cards */}
      <section aria-label="Attendance summary">
        {summaryLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : summary ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <AttendanceSummaryCard
              label="Present Days"
              value={summary.present_days}
              subtext={`of ${summary.total_working_days} working days`}
              icon={CheckCircle2}
              variant="green"
              tooltip="A working day with 4h+ of tracked time, or any physical check-in. Holiday, leave and weekend take priority."
            />
            <AttendanceSummaryCard
              label="Absent Days"
              value={summary.absent_days}
              icon={XCircle}
              variant="red"
              tooltip="A working day with under 2h of tracked time and no check-in."
            />
            <AttendanceSummaryCard
              label="Late Days"
              value={summary.late_days}
              icon={Clock}
              variant="amber"
              tooltip="Days your first check-in was after the org late threshold (default 11:45). Late minutes are counted from the official start (default 11:30)."
            />
            <AttendanceSummaryCard
              label="Half Days"
              value={summary.half_days}
              icon={CalendarDays}
              variant="amber"
              tooltip="A working day with 2h to 4h of tracked time and no check-in."
            />
            <AttendanceSummaryCard
              label="On Leave"
              value={summary.on_leave_days}
              icon={Palmtree}
              variant="blue"
              tooltip="Days covered by an approved leave request."
            />
            <AttendanceSummaryCard
              label="Overtime Hours"
              value={Number(summary.overtime_hours).toFixed(1)}
              icon={Timer}
              variant="purple"
              tooltip="Time worked past the org checkout time (default 20:30), totaled across the month."
            />
          </div>
        ) : null}
      </section>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => {
              setStatusFilter(status);
              setCurrentPage(1);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize',
              statusFilter === status
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={statusFilter === status}
          >
            {status === 'on_leave' ? 'On Leave' : status}
          </button>
        ))}
      </div>

      {/* Attendance Table */}
      <section aria-label="Attendance records">
        {isError ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">
                Failed to load attendance records
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : records.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <CalendarDays className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground font-medium">
                  No attendance records found
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {statusFilter !== 'all'
                    ? 'No records match the selected filter.'
                    : 'Attendance records will appear here once generated.'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {/* Header row */}
              <div className={cn('hidden lg:grid gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border', gridCols)}>
                <span>Date</span>
                <span>Day</span>
                <span>Status</span>
                {hasAnyShift && <span>Shift</span>}
                <span>Clock In</span>
                <span>Clock Out</span>
                <span className="text-right">Hours</span>
                <span className="text-right">Late</span>
                <span className="text-right">Actions</span>
              </div>

              {records.map((record, idx) => (
                <div key={record.id}>
                  {idx > 0 && <Separator />}
                  <div className={cn('grid grid-cols-2 gap-2 px-4 py-3 lg:gap-4 lg:items-center', gridCols)}>
                    <div className="text-sm font-medium text-foreground">
                      {formatDate(record.date)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {record.day}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <AttendanceStatusBadge status={record.status} />
                      {/* All applicable check-in signals — late AND early-checkout
                          coexist by design, so each renders its own badge (deterministic
                          order: Late → Early Checkout → Missing Checkout). The check-ins
                          list row carries late_minutes but not the early-checkout minute
                          count, so early_checkout falls back to generic phrasing while
                          late names the exact "Xh Ym". */}
                      {deriveCheckInBadges(record).map((s) => (
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
                    {hasAnyShift && (
                      <div className="text-sm text-muted-foreground">
                        {record.shift_name || '—'}
                      </div>
                    )}
                    <div className="text-sm text-foreground tabular-nums">
                      {record.clock_in || '—'}
                    </div>
                    <div className="text-sm text-foreground tabular-nums">
                      {record.clock_out || '—'}
                    </div>
                    <div className="text-sm text-foreground tabular-nums text-right">
                      {(() => {
                        // Prefer exact worked_seconds when present; fall back to the
                        // rounded total_hours float (× 3600) for tracker-only rows.
                        const secs =
                          record.worked_seconds != null
                            ? record.worked_seconds
                            : Number(record.total_hours) * 3600;
                        return secs > 0 ? formatDuration(secs) : '—';
                      })()}
                    </div>
                    <div className="text-sm tabular-nums text-right">
                      {record.late_minutes > 0 ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={<span />}
                            className="cursor-help text-amber-600 dark:text-amber-400"
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
                        '—'
                      )}
                    </div>
                    <div className="flex justify-end col-span-2 lg:col-span-1">
                      {canRegularize(record) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openRegularizeDialog(record)}
                          aria-label={`Request regularization for ${formatDate(record.date)}`}
                        >
                          <FileEdit data-icon="inline-start" />
                          Regularize
                        </Button>
                      )}
                      {record.regularization_status === 'pending' && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 self-center">
                          Pending review
                        </span>
                      )}
                      {record.regularization_status === 'approved' && (
                        <span className="text-xs text-green-600 dark:text-green-400 self-center">
                          Regularized
                        </span>
                      )}
                      {record.regularization_status === 'rejected' && (
                        <span className="text-xs text-red-600 dark:text-red-400 self-center">
                          Rejected
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center border-t border-border p-4">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() =>
                          setCurrentPage((p) => Math.max(1, p - 1))
                        }
                        aria-disabled={currentPage === 1}
                        className={
                          currentPage === 1
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(
                        (p) =>
                          p === 1 ||
                          p === totalPages ||
                          Math.abs(p - currentPage) <= 1
                      )
                      .reduce((acc, p, idx, arr) => {
                        if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                        acc.push(p);
                        return acc;
                      }, [] as number[])
                      .map((p, idx) =>
                        p === -1 ? (
                          <PaginationItem key={`ellipsis-${idx}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={p}>
                            <PaginationLink
                              isActive={p === currentPage}
                              onClick={() => setCurrentPage(p)}
                              className="cursor-pointer"
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        )
                      )}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() =>
                          setCurrentPage((p) => Math.min(totalPages, p + 1))
                        }
                        aria-disabled={currentPage === totalPages}
                        className={
                          currentPage === totalPages
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </Card>
        )}
      </section>

      {/* Regularization Dialog */}
      <Dialog
        open={!!regularizeTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRegularizeTarget(null);
            reset();
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmit(handleRegularize)}>
            <DialogHeader>
              <DialogTitle>Request Regularization</DialogTitle>
              <DialogDescription>
                Request a correction for your attendance on{' '}
                {formatDate(regularizeTarget?.date)}.
                Current status:{' '}
                {regularizeTarget?.status
                  ?.replace('_', ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase())}
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" {...register('attendance_record_id')} />

            <div className="flex flex-col gap-4 py-4">
              <div>
                <Label htmlFor="requested_status">Requested Status</Label>
                <Select
                  value={requestedStatus}
                  onValueChange={(v) =>
                    setValue('requested_status', v as 'present' | 'half_day')
                  }
                >
                  <SelectTrigger className="mt-1.5" aria-label="Requested status">
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
                  <p className="mt-1 text-xs text-destructive">
                    {errors.requested_status.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="reason">Reason</Label>
                <Textarea
                  id="reason"
                  placeholder="Explain why your attendance should be corrected..."
                  className="mt-1.5"
                  {...register('reason')}
                  aria-invalid={!!errors.reason}
                />
                {errors.reason && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.reason.message}
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRegularizeTarget(null);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={regularizeMutation.isPending}
              >
                {regularizeMutation.isPending && (
                  <Loader2
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                )}
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
