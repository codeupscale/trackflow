'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Clock,
  Clock4,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useShifts, useDeleteShift } from '@/hooks/hr/use-shifts';
import type { Shift } from '@/lib/validations/shift';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ShiftFormSheet } from '@/components/hr/ShiftFormSheet';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { cn } from '@/lib/utils';

const STATUS_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
] as const;

const DAY_ABBREV: Record<string, string> = {
  monday: 'M',
  tuesday: 'T',
  wednesday: 'W',
  thursday: 'Th',
  friday: 'F',
  saturday: 'Sa',
  sunday: 'Su',
};

export default function ShiftsPage() {
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('shifts.create');

  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusTab, setStatusTab] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchTerm]);

  const clearSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchTerm('');
    setDebouncedSearch('');
    setPage(1);
  };

  const isActiveFilter =
    statusTab === 'active' ? true : statusTab === 'inactive' ? false : undefined;

  const { data, isLoading, isError } = useShifts({
    is_active: isActiveFilter,
    search: debouncedSearch || undefined,
    page,
  });

  const deleteMutation = useDeleteShift();

  const shifts = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;
  const total = data?.total ?? 0;

  const activeCount = shifts.filter((s) => s.is_active).length;
  const inactiveCount = shifts.filter((s) => !s.is_active).length;

  const openCreate = () => {
    setEditingShift(null);
    setDialogOpen(true);
  };

  const openEdit = (shift: Shift) => {
    setEditingShift(shift);
    setDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Shifts</h1>
          <p className="text-xs text-muted-foreground">
            Manage shift schedules for your organization
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Shift
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search shifts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 text-xs pl-8 pr-8"
          />
          {searchTerm && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={clearSearch}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 size-7 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => { setStatusTab(tab.value); setPage(1); }}
              className={cn(
                'rounded-md px-3 py-1.5 text-[0.65rem] font-medium transition-colors',
                statusTab === tab.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={statusTab === tab.value}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total', value: total, icon: Clock4, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Active', value: activeCount, icon: Clock, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Inactive', value: inactiveCount, icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted' },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">
                    {isLoading ? '--' : s.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <Clock4 className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load shifts</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-16" />
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : shifts.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Clock4 className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                {debouncedSearch ? `No shifts match "${debouncedSearch}"` : 'No shifts found'}
              </p>
              <p className="text-xs text-muted-foreground">
                {debouncedSearch
                  ? 'Try adjusting your search.'
                  : 'Create your first shift to start scheduling your team.'}
              </p>
              {canManage && !debouncedSearch && (
                <Button size="sm" className="mt-2 h-7 text-xs" onClick={openCreate}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Shift
                </Button>
              )}
              {debouncedSearch && (
                <Button variant="outline" size="sm" onClick={clearSearch} className="mt-2 h-7 text-xs">
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Shift</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Schedule</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Days</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Break</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Grace</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                      {canManage && (
                        <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((shift) => (
                      <tr key={shift.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: shift.color }}
                            />
                            <div className="min-w-0">
                              <p className="text-[0.75rem] font-medium truncate">{shift.name}</p>
                              {shift.description && (
                                <p className="text-[0.6rem] text-muted-foreground truncate max-w-[180px]">{shift.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-muted-foreground">
                          {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-0.5">
                            {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => (
                              <span
                                key={day}
                                className={cn(
                                  'inline-flex items-center justify-center rounded w-5 h-5 text-[0.5rem] font-semibold',
                                  shift.days_of_week.includes(day as any)
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground/30',
                                )}
                              >
                                {DAY_ABBREV[day]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-muted-foreground text-right">
                          {shift.break_minutes > 0 ? `${shift.break_minutes}m` : '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-muted-foreground text-right">
                          {shift.grace_period_minutes > 0 ? `${shift.grace_period_minutes}m` : '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 text-[0.7rem] font-medium',
                            shift.is_active
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground',
                          )}>
                            <span className={cn(
                              'inline-block w-1.5 h-1.5 rounded-full',
                              shift.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                            )} />
                            {shift.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className="inline-flex items-center justify-center rounded-md h-6 w-6 hover:bg-muted text-muted-foreground"
                                aria-label={`Actions for ${shift.name}`}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEdit(shift)}>
                                  <Pencil className="h-3.5 w-3.5 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setDeleteTarget(shift)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[0.65rem] text-muted-foreground">Page {page} of {totalPages}</p>
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
                        <PaginationItem key={`e-${idx}`}><PaginationEllipsis /></PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink isActive={p === page} onClick={() => setPage(p)} className="cursor-pointer">
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={page === totalPages}
                      className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}

      {/* Create/Edit Dialog */}
      <ShiftFormSheet
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingShift(null);
        }}
        shift={editingShift}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Shift"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
