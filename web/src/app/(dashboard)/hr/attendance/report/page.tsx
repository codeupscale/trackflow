'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Download, Loader2, CalendarDays, Clock, AlertTriangle } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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

  // Derived stats — no new state or hooks, computed from existing data
  const pageEmployees = rows.length;
  const pageWorkedSeconds = rows.reduce((sum, r) => sum + (r.total_worked_seconds ?? 0), 0);
  const pageLateCount = rows.reduce((sum, r) => sum + (r.late_count ?? 0), 0);
  const pageMissingCount = rows.reduce((sum, r) => sum + (r.missing_checkout_count ?? 0), 0);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Check-in Report</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Per-employee check-in rollup for a day or month, across the organization.
          </p>
        </div>

        {canExport && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={exportingView !== null}
              onClick={() => handleExport('summary')}
            >
              {exportingView === 'summary' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Export Summary
            </Button>
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={exportingView !== null}
              onClick={() => handleExport('detail')}
            >
              {exportingView === 'detail' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              Export Detail
            </Button>
          </div>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="size-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Employees</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-8 mt-0.5" />
                ) : (
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{pageEmployees}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Clock className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Total Worked</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-16 mt-0.5" />
                ) : (
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{formatDuration(pageWorkedSeconds)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Late Arrivals</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-8 mt-0.5" />
                ) : (
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{pageLateCount}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <CalendarDays className="size-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Missing Checkouts</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-8 mt-0.5" />
                ) : (
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{pageMissingCount}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Period</Label>
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
            <ToggleGroupItem value="day" className="text-[0.65rem]">Day</ToggleGroupItem>
            <ToggleGroupItem value="month" className="text-[0.65rem]">Month</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {period === 'day' ? (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Date</Label>
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
              <Label htmlFor="report-month" className="text-xs">Month</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => {
                  setMonth(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[140px] h-9 text-sm" aria-label="Select month">
                  <SelectValue>{MONTHS[month - 1]}</SelectValue>
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
              <Label htmlFor="report-year" className="text-xs">Year</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => {
                  setYear(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[100px] h-9 text-sm" aria-label="Select year">
                  <SelectValue>{year}</SelectValue>
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
          <Label className="text-xs">Employee</Label>
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
              <p className="text-center text-xs text-muted-foreground">
                Failed to load check-in report
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-10">
              <div className="text-center">
                <CalendarDays className="mx-auto mb-2 size-5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground">
                  No check-ins in this period
                </p>
                <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                  No employees checked in for the selected {period}.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Employee</th>
                      <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Total</th>
                      <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Days</th>
                      <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Late</th>
                      <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Early / Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.user.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <p className="text-[0.75rem] font-medium text-foreground truncate">{row.user.name}</p>
                          <p className="text-[0.65rem] text-muted-foreground truncate">{row.user.email}</p>
                        </td>
                        <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums text-right whitespace-nowrap">
                          {formatDuration(row.total_worked_seconds)}
                        </td>
                        <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums text-right">
                          {row.days_present}
                        </td>
                        <td className="px-4 py-2.5 text-[0.75rem] tabular-nums text-right">
                          {row.late_count > 0 ? (
                            <span className="inline-flex items-center justify-end gap-1.5 text-[0.7rem] font-medium text-amber-600 dark:text-amber-400">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                              {row.late_count}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[0.75rem] tabular-nums text-right whitespace-nowrap">
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>

            {totalPages > 1 && (
              <div className="flex items-center justify-center border-t border-border p-3">
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
                      <span className="px-3 text-xs text-muted-foreground">
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

      <p className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
        <Users className="size-3" />
        Showing all employees you have permission to view.
      </p>
    </div>
  );
}
