'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Briefcase,
  Filter,
  LayoutGrid,
  List,
  Mail,
  MapPin,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useEmployees, type UseEmployeesParams } from '@/hooks/hr/use-employees';
import type { EmployeeListItem } from '@/lib/validations/employee';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  employmentStatusLabels,
  employmentTypeLabels,
} from '@/lib/validations/employee';

import { EmptyState } from '@/components/common/EmptyState';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';

import { Badge } from '@/components/ui/badge';
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
import { cn, formatDate } from '@/lib/utils';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const avatarColors = [
  'from-blue-500 to-blue-600',
  'from-violet-500 to-violet-600',
  'from-emerald-500 to-emerald-600',
  'from-orange-500 to-orange-600',
  'from-rose-500 to-rose-600',
  'from-cyan-500 to-cyan-600',
  'from-amber-500 to-amber-600',
  'from-indigo-500 to-indigo-600',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const employmentStatusDotColors: Record<string, string> = {
  active: 'bg-emerald-500',
  probation: 'bg-amber-500',
  notice_period: 'bg-yellow-500',
  terminated: 'bg-red-500',
  resigned: 'bg-gray-400',
};

function EmploymentStatusDot({ status }: { status: string }) {
  const dotColor = employmentStatusDotColors[status] ?? 'bg-gray-400';
  const label = employmentStatusLabels[status as keyof typeof employmentStatusLabels] ?? status;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-1.5 rounded-full shrink-0', dotColor)} />
      <span className="text-[0.65rem] text-muted-foreground capitalize">{label}</span>
    </span>
  );
}

export default function EmployeesPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermissionWithScope } = usePermissionStore();

  const isManagerOrAdmin = hasPermissionWithScope('employees.view_directory', 'project');

  useEffect(() => {
    if (user && !isManagerOrAdmin) {
      router.push(`/hr/employees/${user.id}`);
    }
  }, [user, isManagerOrAdmin, router]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [employmentStatus, setEmploymentStatus] = useState<string>('all');
  const [employmentType, setEmploymentType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showFilters, setShowFilters] = useState(false);

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
      per_page: 12,
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

  const activeFilterCount = [
    departmentId != null,
    employmentStatus !== 'all',
    employmentType !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setDepartmentId(null);
    setEmploymentStatus('all');
    setEmploymentType('all');
    setPage(1);
  };

  const activeCount = employees.filter((e) => e.employment_status === 'active').length;

  if (!user || !isManagerOrAdmin) {
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Employee Directory</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            {meta?.total !== undefined
              ? `${meta.total} employee${meta.total !== 1 ? 's' : ''} in your organization`
              : 'Manage your organization\'s employees'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode('list')}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
                <Users className="h-4 w-4 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Total</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{meta?.total ?? employees.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 shrink-0">
                <UserCheck className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Active</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{activeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 shrink-0">
                <Building2 className="h-4 w-4 text-violet-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Departments</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{new Set(employees.map((e) => e.department?.id).filter(Boolean)).size}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 shrink-0">
                <Briefcase className="h-4 w-4 text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Positions</p>
                <p className="text-base font-bold text-foreground tabular-nums leading-tight">{new Set(employees.map((e) => e.position?.id).filter(Boolean)).size}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="border-border">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or ID..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-8 h-8 text-xs"
                aria-label="Search employees"
              />
            </div>

            <div className="h-5 w-px bg-border mx-0.5 hidden sm:block" />

            {/* Filter Toggle */}
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <Badge className="h-4 w-4 p-0 flex items-center justify-center text-[0.55rem] rounded-full bg-primary text-primary-foreground">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1" onClick={clearFilters}>
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>

          {/* Expandable Filters */}
          {showFilters && (
            <div className="flex items-end gap-3 flex-wrap mt-3 pt-3 border-t border-border/50">
              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Department</label>
                <div className="w-[170px]">
                  <DepartmentSelect
                    value={departmentId}
                    onChange={(v) => {
                      setDepartmentId(v);
                      handleFilterChange();
                    }}
                    placeholder="All Departments"
                  />
                </div>
              </div>

              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                <Select
                  value={employmentStatus}
                  onValueChange={(v) => {
                    setEmploymentStatus(v ?? 'all');
                    handleFilterChange();
                  }}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs" aria-label="Filter by status">
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
              </div>

              <div className="grid gap-1">
                <label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
                <Select
                  value={employmentType}
                  onValueChange={(v) => {
                    setEmploymentType(v ?? 'all');
                    handleFilterChange();
                  }}
                >
                  <SelectTrigger className="w-[130px] h-8 text-xs" aria-label="Filter by type">
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <Users className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">Failed to load employees</p>
              <p className="text-sm text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        viewMode === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton className="size-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-36" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="size-8 rounded-full shrink-0" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-24 ml-auto" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-5 w-14" />
                </div>
              ))}
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
        /* ── Grid View ── */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {employees.map((emp) => (
            <Link key={emp.id} href={`/hr/employees/${emp.id}`} className="block group">
              <Card className="transition-all group-hover:border-primary/30 group-hover:shadow-sm h-full">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="size-10 shrink-0 ring-2 ring-background">
                      <AvatarImage src={emp.avatar_url ?? undefined} alt={emp.name} />
                      <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(emp.name)} text-white text-xs font-bold`}>
                        {getInitials(emp.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate leading-tight">{emp.name}</p>
                          <p className="text-[0.65rem] text-muted-foreground truncate mt-0.5">{emp.email}</p>
                        </div>
                        <EmploymentStatusDot status={emp.employment_status} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{emp.department?.name ?? 'No department'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      <span className="truncate">{emp.position?.title ?? emp.job_title ?? 'No position'}</span>
                    </div>
                    {emp.work_location && (
                      <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{emp.work_location}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        /* ── List View ── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[240px]">Employee</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[150px]">Department</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[150px]">Position</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">Type</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[80px]">Status</TableHead>
                    <TableHead className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground w-[100px]">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => router.push(`/hr/employees/${emp.id}`)}
                    >
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8 shrink-0">
                            <AvatarImage src={emp.avatar_url ?? undefined} alt={emp.name} />
                            <AvatarFallback className={`bg-gradient-to-br ${getAvatarColor(emp.name)} text-white text-[0.6rem] font-bold`}>
                              {getInitials(emp.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-[0.7rem] font-medium text-foreground truncate leading-tight">{emp.name}</p>
                            <p className="text-[0.6rem] text-muted-foreground truncate">{emp.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        {emp.department ? (
                          <span className="text-[0.7rem] text-foreground">{emp.department.name}</span>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        {emp.position?.title || emp.job_title ? (
                          <span className="text-[0.7rem] text-foreground">{emp.position?.title ?? emp.job_title}</span>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[0.55rem] px-1.5 py-0 h-4 font-medium">
                          {employmentTypeLabels[emp.employment_type] ?? emp.employment_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <EmploymentStatusDot status={emp.employment_status} />
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2 tabular-nums">
                        {formatDate(emp.date_of_joining)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && !isError && employees.length > 0 && totalPages > 1 && (
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-[0.65rem] text-muted-foreground tabular-nums">
                Showing {meta?.from ?? 0}&ndash;{meta?.to ?? 0} of {meta?.total ?? 0} employees
              </p>
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
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={page === totalPages}
                      className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
