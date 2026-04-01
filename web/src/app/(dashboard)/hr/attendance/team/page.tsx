'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Users } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import { useTeamAttendance } from '@/hooks/hr/use-attendance';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/lib/utils';

export default function TeamAttendancePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isManager =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner';

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

  const { data, isLoading, isError } = useTeamAttendance({
    department_id: departmentId,
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
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
                  No attendance records found
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Adjust your filters or date range to view records.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {/* Header row */}
              <div className="hidden lg:grid lg:grid-cols-7 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
                <span>Employee</span>
                <span>Date</span>
                <span>Status</span>
                <span>Clock In</span>
                <span>Clock Out</span>
                <span className="text-right">Hours</span>
                <span className="text-right">Overtime</span>
              </div>

              {records.map((record, idx) => (
                <div key={record.id}>
                  {idx > 0 && <Separator />}
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 lg:grid-cols-7 lg:gap-4 lg:items-center">
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
                    <div>
                      <AttendanceStatusBadge status={record.status} />
                    </div>
                    <div className="text-sm text-foreground tabular-nums">
                      {record.clock_in || '—'}
                    </div>
                    <div className="text-sm text-foreground tabular-nums">
                      {record.clock_out || '—'}
                    </div>
                    <div className="text-sm text-foreground tabular-nums text-right">
                      {record.total_hours > 0
                        ? record.total_hours.toFixed(1)
                        : '—'}
                    </div>
                    <div className="text-sm tabular-nums text-right">
                      {record.overtime_hours > 0 ? (
                        <span className="text-purple-600 dark:text-purple-400">
                          {record.overtime_hours.toFixed(1)}h
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
