'use client';

import { useState } from 'react';
import {
  Briefcase,
  Plus,
  MoreHorizontal,
  Pencil,
  Archive,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { usePositions, useArchivePosition } from '@/hooks/hr/use-positions';
import {
  positionLevels,
  positionLevelLabels,
  employmentTypeLabels,
  type Position,
} from '@/lib/validations/position';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { PositionFormSheet } from '@/components/hr/PositionFormSheet';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

function formatSalaryRange(
  min: number | null,
  max: number | null
): string {
  if (!min && !max) return '--';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  if (min && max) return `${fmt(min)} - ${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `Up to ${fmt(max)}`;
  return '--';
}

export default function PositionsPage() {
  const { user } = useAuthStore();
  const canManage =
    user?.role === 'owner' ||
    user?.role === 'admin' ||
    user?.role === 'manager';

  const [page, setPage] = useState(1);
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(
    null
  );
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Position | null>(null);

  const { data, isLoading, isError } = usePositions({
    page,
    department_id: departmentFilter ?? undefined,
    level: levelFilter !== 'all' ? levelFilter : undefined,
  });
  const archiveMutation = useArchivePosition();

  const positions = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.last_page ?? 1;

  const openCreate = () => {
    setEditingPos(null);
    setSheetOpen(true);
  };

  const openEdit = (pos: Position) => {
    setEditingPos(pos);
    setSheetOpen(true);
  };

  const handleArchiveConfirm = () => {
    if (!archiveTarget) return;
    archiveMutation.mutate(archiveTarget.id, {
      onSuccess: () => setArchiveTarget(null),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Positions"
        description="Manage job positions within your departments"
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus data-icon="inline-start" />
              Add Position
            </Button>
          ) : undefined
        }
      />

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="w-full sm:w-64">
          <DepartmentSelect
            value={departmentFilter}
            onChange={(val) => {
              setDepartmentFilter(val);
              setPage(1);
            }}
            placeholder="All departments"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={levelFilter}
            onValueChange={(val) => {
              setLevelFilter(val ?? 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full">
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
      </div>

      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
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
            <div className="flex flex-col gap-0">
              <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-20" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0"
                >
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : positions.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No positions found"
          description={
            departmentFilter || levelFilter !== 'all'
              ? 'No positions match the current filters. Try adjusting your selection.'
              : 'Create your first position to define roles within your departments.'
          }
          action={
            canManage && !departmentFilter && levelFilter === 'all' ? (
              <Button onClick={openCreate}>
                <Plus data-icon="inline-start" />
                Add Position
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Employment Type</TableHead>
                    <TableHead>Salary Range</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && (
                      <TableHead className="w-12">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => (
                    <TableRow key={pos.id}>
                      <TableCell className="font-medium">
                        {pos.title}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {pos.code}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {pos.department?.name ?? '--'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {positionLevelLabels[pos.level]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {employmentTypeLabels[pos.employment_type]}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatSalaryRange(pos.min_salary, pos.max_salary)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={pos.is_active ? 'default' : 'secondary'}
                        >
                          {pos.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex items-center justify-center rounded-md size-8 hover:bg-muted text-muted-foreground"
                              aria-label={`Actions for ${pos.title}`}
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => openEdit(pos)}
                              >
                                <Pencil data-icon="inline-start" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setArchiveTarget(pos)}
                              >
                                <Archive data-icon="inline-start" />
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Showing {meta?.from ?? 0}&ndash;{meta?.to ?? 0} of{' '}
                {meta?.total ?? 0} positions
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

      {/* Create/Edit Sheet */}
      <PositionFormSheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
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
