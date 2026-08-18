'use client';

import { useState, useMemo } from 'react';
import {
  Megaphone,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Search,
  SlidersHorizontal,
  X,
  CheckCircle2,
  FileText,
  Briefcase,
  MapPin,
  Clock,
  Building2,
} from 'lucide-react';
import { usePermissionStore } from '@/stores/permission-store';
import {
  useJobPostings,
  useDeleteJobPosting,
  useSetJobPostingPublished,
} from '@/hooks/hr/use-job-postings';
import {
  employmentTypes,
  employmentTypeLabels,
  workModeLabels,
  formatSalaryDisplay,
  withCurrency,
  isFuturePostingDate,
  formatPostingDate,
  type JobPosting,
} from '@/lib/validations/job-posting';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { JobPostingFormDialog } from '@/components/hr/JobPostingFormDialog';
import { JobPostingViewDialog } from '@/components/hr/JobPostingViewDialog';
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

const typeFilterLabels: Record<string, string> = {
  all: 'All Types',
  ...employmentTypeLabels,
};

const statusFilterLabels: Record<string, string> = {
  all: 'All Statuses',
  published: 'Published',
  draft: 'Draft',
};

function to12Hour(value: string): string {
  const [rawHours, minutes] = value.split(':');
  const hours = Number(rawHours);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

function formatWorkingHours(
  start: string | null,
  end: string | null
): string {
  if (!start || !end) return '--';
  return `${to12Hour(start)} - ${to12Hour(end)}`;
}

function salaryCell(posting: JobPosting): string {
  if (!posting.send_salary_via_api) return 'Not published';
  const display =
    posting.salary_display ??
    formatSalaryDisplay(posting.min_salary, posting.max_salary);
  return withCurrency(display) ?? '--';
}

export default function JobPostingsPage() {
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('job_postings.create');
  const canEdit = hasPermission('job_postings.edit');
  const canDelete = hasPermission('job_postings.delete');
  const canPublish = hasPermission('job_postings.publish');
  const showActions = canEdit || canDelete || canPublish;

  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<JobPosting | null>(null);
  const [viewing, setViewing] = useState<JobPosting | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobPosting | null>(null);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, isError } = useJobPostings({
    page,
    department_id: departmentFilter ?? undefined,
    employment_type: typeFilter !== 'all' ? typeFilter : undefined,
    is_published:
      statusFilter === 'all' ? undefined : statusFilter === 'published',
  });

  const deleteMutation = useDeleteJobPosting();
  const publishMutation = useSetJobPostingPublished();

  const allPostings = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.last_page ?? 1;

  const postings = useMemo(() => {
    if (!search) return allPostings;
    const q = search.toLowerCase();
    return allPostings.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.location && p.location.toLowerCase().includes(q))
    );
  }, [allPostings, search]);

  const stats = useMemo(() => {
    const total = meta?.total ?? allPostings.length;
    const published = allPostings.filter((p) => p.is_published).length;
    const draft = allPostings.filter((p) => !p.is_published).length;
    const positions = new Set(allPostings.map((p) => p.position_id).filter(Boolean)).size;
    return { total, published, draft, positions };
  }, [allPostings, meta]);

  const activeFilterCount =
    (departmentFilter ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setSearch('');
    setDepartmentFilter(null);
    setTypeFilter('all');
    setStatusFilter('all');
    setPage(1);
  };

  const viewedPosting = viewing
    ? (postings.find((p) => p.id === viewing.id) ?? viewing)
    : null;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (posting: JobPosting) => {
    setEditing(posting);
    setDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const togglePublished = (posting: JobPosting) => {
    if (
      !posting.is_published &&
      isFuturePostingDate(posting.posting_date)
    ) {
      return;
    }
    publishMutation.mutate({
      id: posting.id,
      is_published: !posting.is_published,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Job Postings</h1>
          <p className="text-xs text-muted-foreground">
            Create job openings and publish them to the careers page
          </p>
        </div>
        {canManage && (
          <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Job Posting
          </Button>
        )}
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Megaphone, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Published', value: stats.published, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Draft', value: stats.draft, icon: FileText, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Positions', value: stats.positions, icon: Briefcase, color: 'text-violet-500', bg: 'bg-violet-500/10' },
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
            placeholder="Search job postings..."
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
            value={typeFilter}
            onValueChange={(val) => {
              setTypeFilter(val ?? 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by employment type">
              <SelectValue placeholder="All Types">
                {(value: string | null) =>
                  typeFilterLabels[value ?? 'all'] ?? 'All Types'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Types</SelectItem>
                {employmentTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {employmentTypeLabels[type]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val ?? 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label="Filter by status">
              <SelectValue placeholder="All Statuses">
                {(value: string | null) =>
                  statusFilterLabels[value ?? 'all'] ?? 'All Statuses'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
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
              <Megaphone className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load job postings
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
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-20" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0"
                >
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : postings.length === 0 && !search && !departmentFilter && typeFilter === 'all' && statusFilter === 'all' ? (
        <EmptyState
          icon={Megaphone}
          title="No job postings yet"
          description="Create your first job posting to advertise an opening on the careers page."
          action={
            canManage ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Job Posting
              </Button>
            ) : undefined
          }
        />
      ) : postings.length === 0 ? (
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
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[200px]">Job Title</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[120px]">Department</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[90px]">Type</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[80px]">Mode</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[100px]">Location</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[110px]">Hours</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[120px]">Salary</TableHead>
                    <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-[80px]">Status</TableHead>
                    {showActions && (
                      <TableHead className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {postings.map((posting) => (
                    <TableRow
                      key={posting.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`View ${posting.title}`}
                      className="border-border/50 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setViewing(posting)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setViewing(posting);
                        }
                      }}
                    >
                      <TableCell className="text-[0.7rem] font-medium py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center h-6 w-6 rounded bg-primary/10 text-primary shrink-0">
                            <Megaphone className="h-3 w-3" />
                          </div>
                          <span className="truncate">{posting.title}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {posting.department?.name ? (
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-3 w-3 text-muted-foreground/60" />
                            {posting.department.name}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">--</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-[0.6rem] px-1.5 py-0">
                          {employmentTypeLabels[posting.employment_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {workModeLabels[posting.work_mode]}
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {posting.location ? (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                            <span className="truncate">{posting.location}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">--</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {posting.start_time && posting.end_time ? (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                            <span className="truncate">{formatWorkingHours(posting.start_time, posting.end_time)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">--</span>
                        )}
                      </TableCell>
                      <TableCell className="text-[0.7rem] text-muted-foreground py-2">
                        {salaryCell(posting)}
                      </TableCell>
                      <TableCell className="py-2">
                        {posting.is_published ? (
                          <span className="inline-flex items-center gap-1 text-[0.6rem] text-emerald-600 dark:text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Published
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[0.6rem] text-muted-foreground">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                            Draft
                          </span>
                        )}
                      </TableCell>
                      {showActions && (
                        <TableCell
                          className="py-2"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex items-center justify-center rounded-md size-7 hover:bg-muted text-muted-foreground"
                              aria-label={`Actions for ${posting.title}`}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canEdit && (
                                <DropdownMenuItem onClick={() => openEdit(posting)}>
                                  <Pencil className="h-3.5 w-3.5 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                              )}
                              {canPublish && (
                                <>
                                  <DropdownMenuItem
                                    disabled={
                                      !posting.is_published &&
                                      isFuturePostingDate(posting.posting_date)
                                    }
                                    onClick={() => togglePublished(posting)}
                                  >
                                    {posting.is_published ? (
                                      <>
                                        <EyeOff className="h-3.5 w-3.5 mr-2" />
                                        Unpublish
                                      </>
                                    ) : (
                                      <>
                                        <Eye className="h-3.5 w-3.5 mr-2" />
                                        Publish
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                  {!posting.is_published &&
                                    isFuturePostingDate(posting.posting_date) && (
                                      <p className="px-2 pb-1 text-[11px] leading-snug text-muted-foreground max-w-48">
                                        Dated{' '}
                                        {formatPostingDate(posting.posting_date!)}
                                        . Change the posting date to publish.
                                      </p>
                                    )}
                                </>
                              )}
                              {canDelete && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setDeleteTarget(posting)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              )}
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

      {/* Detail view */}
      <JobPostingViewDialog
        open={!!viewing && !dialogOpen}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
        posting={viewedPosting}
        onEdit={canEdit ? openEdit : undefined}
        onTogglePublished={canPublish ? togglePublished : undefined}
      />

      {/* Create/Edit Dialog */}
      <JobPostingFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        posting={editing}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Job Posting"
        description={`Are you sure you want to delete "${deleteTarget?.title}"? It will be removed from the careers page immediately.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
