'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import {
  Briefcase,
  Plus,
  MoreHorizontal,
  Pencil,
  Archive,
  Search,
  SlidersHorizontal,
  X,
  CheckCircle2,
  XCircle,
  Building2,
  Layers,
} from 'lucide-react';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { usePositions, useArchivePosition } from '@/hooks/hr/use-positions';
import {
  positionLevels,
  positionLevelLabels,
  employmentTypes,
  employmentTypeLabels,
  type Position,
} from '@/lib/validations/position';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PositionFormSheet } from '@/components/hr/PositionFormSheet';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

export default function PositionsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('positions.create');

  // The sidebar hides this from anyone without positions.view, but a menu that
  // filters on key presence gates a menu and nothing else — a bookmark or typed
  // URL walked straight in and landed on a page of 403s (the whole positions
  // resource is behind permission:positions.view).
  const canViewPositions = hasPermission('positions.view');

  useEffect(() => {
    if (user && !canViewPositions) {
      router.replace('/dashboard');
    }
  }, [user, canViewPositions, router]);

  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Position | null>(null);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, isError } = usePositions({
    page,
    department_id: departmentFilter ?? undefined,
    level: levelFilter !== 'all' ? levelFilter : undefined,
  });
  const archiveMutation = useArchivePosition();

  const allPositions = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.last_page ?? 1;

  const positions = useMemo(() => {
    if (!search) return allPositions;
    const q = search.toLowerCase();
    return allPositions.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q)
    );
  }, [allPositions, search]);

  const stats = useMemo(() => {
    const total = meta?.total ?? allPositions.length;
    const active = allPositions.filter((p) => p.is_active).length;
    const inactive = allPositions.filter((p) => !p.is_active).length;
    const depts = new Set(allPositions.map((p) => p.department_id).filter(Boolean)).size;
    return { total, active, inactive, depts };
  }, [allPositions, meta]);

  const activeFilterCount =
    (departmentFilter ? 1 : 0) + (levelFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setSearch('');
    setDepartmentFilter(null);
    setLevelFilter('all');
    setPage(1);
  };

  const openCreate = () => {
    setEditingPos(null);
    setDialogOpen(true);
  };

  const openEdit = (pos: Position) => {
    setEditingPos(pos);
    setDialogOpen(true);
  };

  const handleArchiveConfirm = () => {
    if (!archiveTarget) return;
    archiveMutation.mutate(archiveTarget.id, {
      onSuccess: () => setArchiveTarget(null),
    });
  };

  // Hold the spinner until the permission map has loaded, so an authorised user
  // never sees a flash of the redirect.
  if (!user || !canViewPositions) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Positions</h1>
          <p className="text-xs text-muted-foreground">
            Manage job positions within your departments
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Position
          </Button>
        )}
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Briefcase, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Inactive', value: stats.inactive, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Departments', value: stats.depts, icon: Building2, color: 'text-violet-500', bg: 'bg-violet-500/10' },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{isLoading ? '--' : s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search positions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Button
          variant={showFilters ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[0.6rem] rounded-full ml-0.5">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1 text-muted-foreground"
            onClick={clearFilters}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Collapsible Filters */}
      {showFilters && (
        <div className="flex items-center gap-3">
          <div className="w-[180px]">
            <DepartmentSelect
              value={departmentFilter}
              onChange={(val) => {
                setDepartmentFilter(val);
                setPage(1);
              }}
              placeholder="All departments"
            />
          </div>
          <Select
            value={levelFilter}
            onValueChange={(val) => {
              setLevelFilter(val ?? 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Levels</SelectItem>
                {positionLevels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {positionLevelLabels[level]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-10">
            <div className="flex flex-col items-center text-center gap-3">
              <Briefcase className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load positions
              </p>
              <p className="text-sm text-muted-foreground">
                Please try again later.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-20" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0"
                >
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-5 w-14" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : positions.length === 0 && !search && !departmentFilter && levelFilter === 'all' ? (
        <EmptyState
          icon={Briefcase}
          title="No positions yet"
          description="Create your first position to define roles within your departments."
          action={
            canManage ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Position
              </Button>
            ) : undefined
          }
        />
      ) : positions.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center gap-2">
              <Search className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No results found</p>
              <p className="text-xs text-muted-foreground">
                Try adjusting your search or filters
              </p>
              <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[220px]">Title</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[100px]">Code</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[150px]">Department</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[90px]">Level</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[110px]">Type</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[80px]">Status</TableHead>
                    {canManage && (
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => (
                    <TableRow key={pos.id} className="border-border/50 hover:bg-muted/30">
                      <TableCell className="text-[0.7rem] font-medium py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center h-6 w-6 rounded bg-primary/10 text-primary shrink-0">
                            <Briefcase className="h-3 w-3" />
                          </div>
                          <span className="truncate">{pos.title}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        <Badge variant="outline" className="text-[0.6rem] font-mono px-1.5 py-0">
                          {pos.code}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {pos.department?.name ? (
                          <div className="flex items-center gap-1.5">
                            <Layers className="h-3 w-3 text-muted-foreground/60" />
                            {pos.department.name}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">--</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[0.6rem] px-1.5 py-0">
                          {positionLevelLabels[pos.level]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {employmentTypeLabels[pos.employment_type]}
                      </TableCell>
                      <TableCell className="py-2">
                        {pos.is_active ? (
                          <span className="inline-flex items-center gap-1 text-[0.6rem] text-emerald-600 dark:text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[0.6rem] text-muted-foreground">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                            Inactive
                          </span>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="py-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex items-center justify-center rounded-md size-7 hover:bg-muted text-muted-foreground"
                              aria-label={`Actions for ${pos.title}`}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(pos)}>
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setArchiveTarget(pos)}
                              >
                                <Archive className="h-3.5 w-3.5 mr-2" />
                                Archive
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-[0.65rem] text-muted-foreground">
                Showing {meta?.from ?? 0}&ndash;{meta?.to ?? 0} of{' '}
                {meta?.total ?? 0}
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
        </>
      )}

      {/* Create/Edit Dialog */}
      <PositionFormSheet
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingPos(null);
        }}
        position={editingPos}
      />

      {/* Archive Confirmation */}
      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title="Archive Position"
        description={`Are you sure you want to archive "${archiveTarget?.title}"? This will hide it from active position lists.`}
        confirmLabel="Archive"
        onConfirm={handleArchiveConfirm}
        isPending={archiveMutation.isPending}
      />
    </div>
  );
}
