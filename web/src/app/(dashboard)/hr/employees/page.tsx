'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  Search,
  LayoutGrid,
  List,
} from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { useEmployees, type UseEmployeesParams } from '@/hooks/hr/use-employees';
import type { EmployeeListItem } from '@/lib/validations/employee';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  employmentStatusLabels,
  employmentTypeLabels,
} from '@/lib/validations/employee';

import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { EmployeeCard } from '@/components/hr/EmployeeCard';
import { EmployeeStatusBadge } from '@/components/hr/EmployeeStatusBadge';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { formatDate } from '@/lib/utils';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function EmployeesPage() {
  const { user } = useAuthStore();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [employmentStatus, setEmploymentStatus] = useState<string>('all');
  const [employmentType, setEmploymentType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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
      setPage(1);
    }, 300);
  };

  const params: UseEmployeesParams = useMemo(
    () => ({
      page,
      search: debouncedSearch || undefined,
      department_id: departmentId ?? undefined,
      employment_status: employmentStatus !== 'all' ? employmentStatus : undefined,
      employment_type: employmentType !== 'all' ? employmentType : undefined,
    }),
    [page, debouncedSearch, departmentId, employmentStatus, employmentType]
  );

  const { data, isLoading, isError } = useEmployees(params);

  const employees = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.last_page ?? 1;

  const handleFilterChange = () => {
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employee Directory"
        description={
          meta?.total !== undefined
            ? `${meta.total} employee${meta.total !== 1 ? 's' : ''}`
            : 'Manage your organization\'s employees'
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or ID..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              aria-label="Search employees"
            />
          </div>

          <div className="w-48">
            <DepartmentSelect
              value={departmentId}
              onChange={(v) => {
                setDepartmentId(v);
                handleFilterChange();
              }}
              placeholder="All Departments"
            />
          </div>

          <Select
            value={employmentStatus}
            onValueChange={(v) => {
              setEmploymentStatus(v);
              handleFilterChange();
            }}
          >
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Statuses</SelectItem>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {employmentStatusLabels[s]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={employmentType}
            onValueChange={(v) => {
              setEmploymentType(v);
              handleFilterChange();
            }}
          >
            <SelectTrigger className="w-36" aria-label="Filter by type">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Types</SelectItem>
                {EMPLOYMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {employmentTypeLabels[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
          >
            <LayoutGrid />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
          >
            <List />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <Users className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load employees
              </p>
              <p className="text-sm text-muted-foreground">
                Please try again later.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        viewMode === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="flex flex-col items-center gap-3 py-6">
                  <Skeleton className="size-16 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-col gap-0">
                <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-24" />
                  ))}
                </div>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0"
                  >
                    <Skeleton className="size-8 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      ) : employees.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No employees found"
          description={
            debouncedSearch || departmentId || employmentStatus !== 'all' || employmentType !== 'all'
              ? 'Try adjusting your filters to find what you\'re looking for.'
              : 'Employee profiles will appear here once team members are added.'
          }
        />
      ) : viewMode === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {employees.map((emp) => (
            <EmployeeCard key={emp.id} employee={emp} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => (
                  <TableRow
                    key={emp.id}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <Link
                        href={`/hr/employees/${emp.id}`}
                        className="flex items-center gap-3"
                      >
                        <Avatar className="size-8">
                          <AvatarImage
                            src={emp.avatar_url ?? undefined}
                            alt={emp.name}
                          />
                          <AvatarFallback className="text-xs">
                            {getInitials(emp.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-foreground truncate">
                            {emp.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {emp.email}
                          </p>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {emp.department?.name ?? '--'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {emp.position?.title ?? emp.job_title ?? '--'}
                    </TableCell>
                    <TableCell>
                      <EmployeeStatusBadge status={emp.employment_status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(emp.date_of_joining)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && !isError && employees.length > 0 && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Showing {meta?.from ?? 0}&ndash;{meta?.to ?? 0} of{' '}
            {meta?.total ?? 0} employees
          </p>
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
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - page) <= 1
                )
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push(-1);
                  acc.push(p);
                  return acc;
                }, [] as number[])
                .map((p, idx) =>
                  p === -1 ? (
                    <PaginationItem key={`e-${idx}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink
                        isActive={p === page}
                        onClick={() => setPage(p)}
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
                    setPage((p) => Math.min(totalPages, p + 1))
                  }
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
    </div>
  );
}
