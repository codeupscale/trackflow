'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Download, Loader2, CalendarDays } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { EmployeeSelect } from '@/components/hr/EmployeeSelect';
import { useCheckInsSummary, exportCheckIns } from '@/hooks/hr/use-check-in';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { formatDuration } from '@/lib/check-in-time';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type Period = 'day' | 'month';

export default function CheckInReportPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canViewAll = hasPermission('attendance.view_all');
  const canExport = hasPermission('attendance.export');

  const now = new Date();
  const [period, setPeriod] = useState<Period>('day');
  const [day, setDay] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  );
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState<string | null>(null);
  const [exportingView, setExportingView] = useState<'detail' | 'summary' | null>(null);

  const monthString = `${year}-${String(month).padStart(2, '0')}`;

  const summaryFilters = useMemo(
    () =>
      period === 'day'
        ? { period: 'day' as const, date: day, user_id: userId, page }
        : { period: 'month' as const, month: monthString, user_id: userId, page },
    [period, day, monthString, userId, page]
  );

  const { data, isLoading, isError } = useCheckInsSummary(summaryFilters);

  const rows = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current, current - 1, current - 2];
  }, []);

  // Role gate — hard early return, no content flash.
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          Loading...
        </div>
      </div>
    );
  }

  if (!canViewAll) {
    router.push('/hr/attendance');
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          Redirecting...
        </div>
      </div>
    );
  }

  const handleExport = async (view: 'detail' | 'summary') => {
    setExportingView(view);
    try {
      await exportCheckIns(
        period === 'day'
          ? { period: 'day', date: day, user_id: userId, view }
          : { period: 'month', month: monthString, user_id: userId, view }
      );
    } catch {
      // toast already surfaced by exportCheckIns
    } finally {
      setExportingView(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Check-in Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-employee check-in rollup for a day or month, across the organization.
          </p>
        </div>

        {canExport && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={exportingView !== null}
              onClick={() => handleExport('summary')}
            >
              {exportingView === 'summary' ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              Export Summary
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exportingView !== null}
              onClick={() => handleExport('detail')}
            >
              {exportingView === 'detail' ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              Export Detail
            </Button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label>Period</Label>
          <ToggleGroup
            value={[period]}
            onValueChange={(val) => {
              const v = val[0];
              if (v === 'day' || v === 'month') {
                setPeriod(v);
                setPage(1);
              }
            }}
            variant="outline"
          >
            <ToggleGroupItem value="day">Day</ToggleGroupItem>
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {period === 'day' ? (
          <div className="flex flex-col gap-1.5">
            <Label>Date</Label>
            <DatePicker
              value={day}
              onChange={(v) => {
                setDay(v);
                setPage(1);
              }}
            />
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-month">Month</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => {
                  setMonth(Number(v));
                  setPage(1);
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-year">Year</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => {
                  setYear(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[100px]" aria-label="Select year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5 w-full sm:w-[240px]">
          <Label>Employee</Label>
          <EmployeeSelect
            value={userId}
            onChange={(val) => {
              setUserId(val);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Summary table */}
      <section aria-label="Check-in summary by employee">
        {isError ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">
                Failed to load check-in report
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
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <CalendarDays className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground font-medium">
                  No check-ins in this period
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  No employees checked in for the selected {period}.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="hidden lg:grid lg:grid-cols-6 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
                <span className="col-span-2">Employee</span>
                <span className="text-right">Total</span>
                <span className="text-right">Days</span>
                <span className="text-right">Late</span>
                <span className="text-right">Early / Missing</span>
              </div>

              {rows.map((row, idx) => (
                <div key={row.user.id}>
                  {idx > 0 && <Separator />}
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 lg:grid-cols-6 lg:gap-4 lg:items-center">
                    <div className="col-span-2 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {row.user.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {row.user.email}
                      </p>
                    </div>
                    <div className="text-sm text-foreground tabular-nums text-right">
                      {formatDuration(row.total_worked_seconds)}
                    </div>
                    <div className="text-sm text-foreground tabular-nums text-right">
                      {row.days_present}
                    </div>
                    <div className="text-sm tabular-nums text-right">
                      {row.late_count > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {row.late_count}
                        </span>
                      ) : (
                        '—'
                      )}
                    </div>
                    <div className="text-sm tabular-nums text-right">
                      <span
                        className={
                          row.early_checkout_count > 0
                            ? 'text-orange-600 dark:text-orange-400'
                            : 'text-muted-foreground'
                        }
                      >
                        {row.early_checkout_count}
                      </span>
                      {' / '}
                      <span
                        className={
                          row.missing_checkout_count > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-muted-foreground'
                        }
                      >
                        {row.missing_checkout_count}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>

            {totalPages > 1 && (
              <div className="flex items-center justify-center border-t border-border p-4">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        aria-disabled={page === 1}
                        className={
                          page === 1
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-3 text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        aria-disabled={page === totalPages}
                        className={
                          page === totalPages
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

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5" />
        Showing all employees you have permission to view.
      </p>
    </div>
  );
}
