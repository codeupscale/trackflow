'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Clock, Search, Users, X, CheckCircle2, XCircle, Timer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { CheckInStatusBadge, type CheckInBadgeStatus } from '@/components/hr/CheckInStatusBadge';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import {
  deriveCheckInBadges,
  formatDuration,
  formatMinutes,
  checkInBadgeTooltip,
  dayPresenceSeconds,
  requiredDaySeconds,
} from '@/lib/check-in-time';
import { useTeamAttendance } from '@/hooks/hr/use-attendance';
import { useTodayStatus } from '@/hooks/hr/use-check-in';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { formatDate, formatDecimal } from '@/lib/utils';

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  present: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Present' },
  absent: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Absent' },
  half_day: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Half Day' },
  on_leave: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', label: 'On Leave' },
  holiday: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Holiday' },
  weekend: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'Weekend' },
};

export default function TeamAttendancePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermissionWithScope, hasPermission } = usePermissionStore();
  const isManager = hasPermissionWithScope('attendance.view', 'project');
  const canCheckIn = hasPermission('attendance.check_in');

  // Pull org policy times so the Late tooltip can name a concrete anchor ("after the
  // 11:30 AM official start"). Gated on attendance.check_in (the `today` endpoint's
  // permission); falls back to generic phrasing when unavailable. Mirrors My Attendance.
  const { data: todayStatus } = useTodayStatus({ enabled: canCheckIn });
  const policyCheckInTime = todayStatus?.policy?.check_in_time;

  useEffect(() => {
    if (user && !isManager) {
      router.push('/hr/attendance');
    }
  }, [user, isManager, router]);

  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  });
  const [currentPage, setCurrentPage] = useState(1);

  // Employee search — debounced so typing doesn't fire a request per keystroke.
  // ANDs with the department filter server-side, so it narrows within the
  // selected department rather than searching the whole org.
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
    start_date: dateFrom,
    end_date: dateTo,
    page: currentPage,
  });

  const records = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;

  // Derive summary stats from the current page of records
  const stats = useMemo(() => {
    const present = records.filter((r) => r.status === 'present').length;
    const absent = records.filter((r) => r.status === 'absent').length;
    const late = records.filter((r) => (r.check_in_late_minutes ?? r.late_minutes ?? 0) > 0).length;
    const overtimeTotal = records.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0);
    return { present, absent, late, overtimeTotal };
  }, [records]);

  // Role gate: show loading until auth resolves
  if (!user || !isManager) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          {!user ? 'Loading...' : 'Redirecting...'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Team Attendance</h1>
        <p className="text-xs text-muted-foreground">
          View attendance records for your team members
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1 w-full sm:w-[220px]">
          <Label htmlFor="employee-search" className="text-xs">Employee</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              id="employee-search"
              type="search"
              placeholder="Search by name, email, or ID..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-8 pr-8 h-8 text-xs"
              aria-label="Search employees"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearSearch}
                aria-label="Clear employee search"
                className="absolute right-0.5 top-1/2 -translate-y-1/2 size-7 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 w-full sm:w-[180px]">
          <Label htmlFor="department-filter" className="text-xs">Department</Label>
          <DepartmentSelect
            value={departmentId}
            onChange={(val) => {
              setDepartmentId(val);
              setCurrentPage(1);
            }}
            placeholder="All departments"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="date-from" className="text-xs">From</Label>
          <Input
            id="date-from"
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => {
              setDateFrom(e.target.value);
              if (e.target.value > dateTo) setDateTo(e.target.value);
              setCurrentPage(1);
            }}
            className="w-[140px] h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="date-to" className="text-xs">To</Label>
          <Input
            id="date-to"
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => {
              setDateTo(e.target.value);
              setCurrentPage(1);
            }}
            className="w-[140px] h-8 text-xs"
          />
        </div>
      </div>

      {/* Stats Strip */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-3"><Skeleton className="h-10" /></CardContent></Card>
          ))}
        </div>
      ) : records.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Present', value: stats.present, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            { label: 'Absent', value: stats.absent, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
            { label: 'Late', value: stats.late, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
            { label: 'Overtime', value: `${formatDecimal(stats.overtimeTotal)}h`, icon: Timer, color: 'text-violet-500', bg: 'bg-violet-500/10' },
          ].map((s) => (
            <Card key={s.label} className="border-border">
              <CardContent className="p-3">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                    <p className="text-base font-bold text-foreground tabular-nums leading-tight">{s.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Team Attendance Table */}
      <section aria-label="Team attendance records">
        {isError ? (
          <Card className="border-destructive/50">
            <CardContent className="py-12">
              <div className="flex flex-col items-center gap-2">
                <CalendarDays className="h-8 w-8 text-destructive/60" />
                <p className="text-sm text-muted-foreground font-medium">Failed to load team attendance</p>
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
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-3.5 w-14" />
                    <Skeleton className="h-3.5 w-14" />
                    <Skeleton className="h-3.5 w-14" />
                    <Skeleton className="h-3.5 w-12" />
                    <Skeleton className="h-3.5 w-10" />
                    <Skeleton className="h-3.5 w-10" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : records.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center text-center gap-2">
                <Users className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground font-medium">
                  {debouncedSearch
                    ? `No employees match "${debouncedSearch}"`
                    : 'No attendance records found'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Adjust your filters or date range to view records.
                </p>
                {debouncedSearch && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSearch}
                    className="mt-2 h-8 text-xs"
                  >
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
                        const sd = statusDot[record.status] ?? statusDot.absent;
                        const checkInBadges = deriveCheckInBadges(record);
                        const secs =
                          record.worked_seconds != null
                            ? record.worked_seconds
                            : Number(record.total_hours) * 3600;

                        return (
                          <tr key={record.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <p className="text-[0.75rem] font-medium text-foreground truncate max-w-[180px]">
                                {record.user?.name || '—'}
                              </p>
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
                                {/* Late and early-checkout coexist by design — render each
                                    applicable badge (order: Late -> Early Checkout -> Missing
                                    Checkout). */}
                                {checkInBadges.map((s) => (
                                  <CheckInStatusBadge
                                    key={s}
                                    status={s as CheckInBadgeStatus}
                                    tooltip={checkInBadgeTooltip(s, {
                                      lateMinutes: record.check_in_late_minutes,
                                      checkInTime: policyCheckInTime,
                                      presenceSeconds: dayPresenceSeconds(record),
                                      requiredSeconds: requiredDaySeconds(record.shift),
                                    })}
                                  />
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums">
                              {record.clock_in || <span className="text-muted-foreground/40">&mdash;</span>}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums">
                              {record.clock_out || <span className="text-muted-foreground/40">&mdash;</span>}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right text-[0.75rem] tabular-nums">
                              {secs > 0 ? formatDuration(secs) : <span className="text-muted-foreground/40">&mdash;</span>}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right">
                              {(record.check_in_late_minutes ?? 0) > 0 ? (
                                <Tooltip>
                                  <TooltipTrigger
                                    render={<span />}
                                    className="cursor-help text-[0.75rem] tabular-nums text-amber-600 dark:text-amber-400 font-medium"
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
                              ) : (
                                <span className="text-[0.75rem] text-muted-foreground/40">&mdash;</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-right">
                              {Number(record.overtime_hours) > 0 ? (
                                <span className="text-[0.75rem] tabular-nums text-purple-600 dark:text-purple-400 font-medium">
                                  {formatDecimal(record.overtime_hours)}h
                                </span>
                              ) : (
                                <span className="text-[0.75rem] text-muted-foreground/40">&mdash;</span>
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-1">
                <p className="text-[0.65rem] text-muted-foreground">Page {currentPage} of {totalPages}</p>
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
                          currentPage >= totalPages
                            ? 'pointer-events-none opacity-50'
                            : 'cursor-pointer'
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
