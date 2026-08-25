'use client';

import { useState, useMemo } from 'react';
import {
  Building2,
  Plus,
  MoreHorizontal,
  Pencil,
  Archive,
  Search,
  Layers,
  CheckCircle2,
  XCircle,
  Users,
} from 'lucide-react';
import { usePermissionStore } from '@/stores/permission-store';
import {
  useDepartments,
  useArchiveDepartment,
} from '@/hooks/hr/use-departments';
import { codeBadgeColor, type Department } from '@/lib/validations/department';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  DepartmentFormSheet,
  type DepartmentModalMode,
} from '@/components/hr/DepartmentFormSheet';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
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

export default function DepartmentsPage() {
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('departments.create');

  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [dialogMode, setDialogMode] = useState<DepartmentModalMode>('edit');
  const [archiveTarget, setArchiveTarget] = useState<Department | null>(null);

  const [search, setSearch] = useState('');
  const [viewTab, setViewTab] = useState<'active' | 'archived'>('active');

  const { data, isLoading, isError } = useDepartments({ page });
  const archiveMutation = useArchiveDepartment();

  const allDepartments = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.last_page ?? 1;

  const departments = useMemo(() => {
    let filtered = allDepartments.filter((d) =>
      viewTab === 'active' ? d.is_active : !d.is_active
    );
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.code.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allDepartments, search, viewTab]);

  const stats = useMemo(() => {
    const total = allDepartments.length;
    const active = allDepartments.filter((d) => d.is_active).length;
    const inactive = total - active;
    const archived = allDepartments.filter((d) => !d.is_active).length;
    return { total, active, inactive, archived };
  }, [allDepartments]);

  // `editingDept` is a SNAPSHOT taken when the row was clicked. After an edit
  // saves and the modal returns to its view pane, that snapshot still holds the
  // pre-edit values — the user would see their own change missing. Re-resolve it
  // against the freshly refetched list by id so the view pane shows saved state,
  // falling back to the snapshot if the row is not on the current page.
  const activeDept = editingDept
    ? (allDepartments.find((d) => d.id === editingDept.id) ?? editingDept)
    : null;

  const clearFilters = () => {
    setSearch('');
  };

  const openCreate = () => {
    setEditingDept(null);
    setDialogMode('edit');
    setDialogOpen(true);
  };

  const openEdit = (dept: Department) => {
    setEditingDept(dept);
    setDialogMode('edit');
    setDialogOpen(true);
  };

  const openView = (dept: Department) => {
    setEditingDept(dept);
    setDialogMode('view');
    setDialogOpen(true);
  };

  const handleArchiveConfirm = () => {
    if (!archiveTarget) return;
    archiveMutation.mutate(archiveTarget.id, {
      onSuccess: () => setArchiveTarget(null),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Departments</h1>
          <p className="text-xs text-muted-foreground">
            Manage your organization&apos;s department structure
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Department
          </Button>
        )}
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Building2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Inactive', value: stats.inactive, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Archived', value: stats.archived, icon: Archive, color: 'text-amber-500', bg: 'bg-amber-500/10' },
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

      {/* Search + Tabs */}
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search departments..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex items-center rounded-lg border border-border p-0.5 gap-0.5">
          <button
            onClick={() => setViewTab('active')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${viewTab === 'active' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
          >
            Active
          </button>
          <button
            onClick={() => setViewTab('archived')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${viewTab === 'archived' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
          >
            Archived
            {stats.archived > 0 && (
              <span className={`text-[0.6rem] rounded-full px-1.5 py-0 leading-tight ${viewTab === 'archived' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'}`}>
                {stats.archived}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-10">
            <div className="flex flex-col items-center text-center gap-3">
              <Building2 className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load departments
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
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-20" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0"
                >
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5 w-10" />
                  <Skeleton className="h-5 w-14" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : departments.length === 0 && !search && viewTab === 'active' ? (
        <EmptyState
          icon={Building2}
          title="No departments yet"
          description="Create your first department to start organizing your team structure."
          action={
            canManage ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Department
              </Button>
            ) : undefined
          }
        />
      ) : departments.length === 0 && viewTab === 'archived' ? (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center gap-2">
              <Archive className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No archived departments</p>
              <p className="text-xs text-muted-foreground">
                Archived departments will appear here
              </p>
            </div>
          </CardContent>
        </Card>
      ) : departments.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center gap-2">
              <Search className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No results found</p>
              <p className="text-xs text-muted-foreground">
                Try adjusting your search
              </p>
              <Button variant="ghost" size="sm" className="mt-1 text-xs" onClick={clearFilters}>
                Clear search
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
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[240px]">Name</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[100px]">Code</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[180px]">Parent</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[90px]">Employees</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[80px]">Status</TableHead>
                    {canManage && (
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((dept) => (
                    <TableRow
                      key={dept.id}
                      onClick={() => openView(dept)}
                      className="border-border/50 hover:bg-muted/30 cursor-pointer"
                    >
                      <TableCell className="text-[0.7rem] font-medium py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center h-6 w-6 rounded bg-primary/10 text-primary shrink-0">
                            <Building2 className="h-3 w-3" />
                          </div>
                          <span className="truncate">{dept.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.6rem] font-semibold font-mono ${codeBadgeColor(dept.code)}`}>
                          {dept.code}
                        </span>
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {dept.parent?.name ? (
                          <div className="flex items-center gap-1.5">
                            <Layers className="h-3 w-3 text-muted-foreground/60" />
                            {dept.parent.name}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">--</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-foreground">
                          <Users className="h-3 w-3 text-muted-foreground/60" />
                          <span className="tabular-nums font-medium">{dept.employees_count ?? 0}</span>
                        </span>
                      </TableCell>
                      <TableCell className="py-2">
                        {dept.is_active ? (
                          <span className="inline-flex items-center gap-1 text-[0.6rem] text-emerald-600 dark:text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[0.6rem] text-amber-600 dark:text-amber-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Archived
                          </span>
                        )}
                      </TableCell>
                      {canManage && (
                        // stopPropagation so opening the actions menu doesn't
                        // also fire the row's view-modal click.
                        <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex items-center justify-center rounded-md size-7 hover:bg-muted text-muted-foreground"
                              aria-label={`Actions for ${dept.name}`}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(dept)}>
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setArchiveTarget(dept)}
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
      <DepartmentFormSheet
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingDept(null);
        }}
        department={activeDept}
        initialMode={dialogMode}
      />

      {/* Archive Confirmation */}
      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title="Archive Department"
        description={`Are you sure you want to archive "${archiveTarget?.name}"? This will hide it from active department lists.`}
        confirmLabel="Archive"
        onConfirm={handleArchiveConfirm}
        isPending={archiveMutation.isPending}
      />
    </div>
  );
}
