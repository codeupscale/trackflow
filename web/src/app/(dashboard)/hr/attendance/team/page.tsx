'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
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

import { AttendanceStatusBadge } from '@/components/hr/AttendanceStatusBadge';
import { CheckInStatusBadge, type CheckInBadgeStatus } from '@/components/hr/CheckInStatusBadge';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import {
  deriveCheckInBadges,
  formatDuration,
  formatMinutes,
  checkInBadgeTooltip,
} from '@/lib/check-in-time';
import { useTeamAttendance } from '@/hooks/hr/use-attendance';
import { useTodayStatus } from '@/hooks/hr/use-check-in';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { formatDate } from '@/lib/utils';

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
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Team Attendance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View attendance records for your team members
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-col gap-1.5 w-full sm:w-[260px]">
          <Label htmlFor="employee-search">Employee</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              id="employee-search"
              type="search"
              placeholder="Search by name, email, or ID..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-9"
              aria-label="Search employees"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearSearch}
                aria-label="Clear employee search"
                className="absolute right-1 top-1/2 -translate-y-1/2 size-7 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 w-full sm:w-[200px]">
          <Label htmlFor="department-filter">Department</Label>
          <DepartmentSelect
            value={departmentId}
            onChange={(val) => {
              setDepartmentId(val);
              setCurrentPage(1);
            }}
            placeholder="All departments"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date-from">From</Label>
          <Input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setCurrentPage(1);
            }}
            className="w-[160px]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date-to">To</Label>
          <Input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setCurrentPage(1);
            }}
            className="w-[160px]"
          />
        </div>
      </div>

      {/* Team Attendance Table */}
      <section aria-label="Team attendance records">
        {isError ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">
                Failed to load team attendance
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
                <Users className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground font-medium">
                  {debouncedSearch
                    ? `No employees match "${debouncedSearch}"`
                    : 'No attendance records found'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Adjust your filters or date range to view records.
                </p>
                {debouncedSearch && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearSearch}
                    className="mt-4"
                  >
                    Clear search
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {/* Header row */}
              <div className="hidden lg:grid lg:grid-cols-8 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
                <span>Employee</span>
                <span>Date</span>
                <span>Status</span>
                <span>Clock In</span>
                <span>Clock Out</span>
                <span className="text-right">Hours</span>
                <span className="text-right">Late</span>
                <span className="text-right">Overtime</span>
              </div>

              {records.map((record, idx) => (
                <div key={record.id}>
                  {idx > 0 && <Separator />}
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 lg:grid-cols-8 lg:gap-4 lg:items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {record.user?.name || '—'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate lg:hidden">
                        {record.user?.email || ''}
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(record.date)}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <AttendanceStatusBadge status={record.status} />
                      {/* Late and early-checkout coexist by design — render each
                          applicable badge (order: Late → Early Checkout → Missing
                          Checkout). Tooltips are omitted here (team view has no policy
                          context loaded). */}
                      {deriveCheckInBadges(record).map((s) => (
                        <CheckInStatusBadge key={s} status={s as CheckInBadgeStatus} />
                      ))}
                    </div>
                    <div className="text-sm text-foreground tabular-nums">
                      {record.clock_in || '—'}
                    </div>
                    <div className="text-sm text-foreground tabular-nums">
                      {record.clock_out || '—'}
                    </div>
                    <div className="text-sm text-foreground tabular-nums text-right">
                      {(() => {
                        // Prefer exact worked_seconds; fall back to rounded total_hours.
                        const secs =
                          record.worked_seconds != null
                            ? record.worked_seconds
                            : Number(record.total_hours) * 3600;
                        return secs > 0 ? formatDuration(secs) : '—';
                      })()}
                    </div>
                    <div className="text-sm tabular-nums text-right">
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
                      ) : (
                        '—'
                      )}
                    </div>
                    <div className="text-sm tabular-nums text-right">
                      {Number(record.overtime_hours) > 0 ? (
                        <span className="text-purple-600 dark:text-purple-400">
                          {Number(record.overtime_hours).toFixed(1)}h
                        </span>
                      ) : (
                        '—'
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
    </div>
  );
}
