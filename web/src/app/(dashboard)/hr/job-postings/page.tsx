'use client';

import { useState } from 'react';
import {
  Megaphone,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
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
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { JobPostingFormDialog } from '@/components/hr/JobPostingFormDialog';
import { JobPostingViewDialog } from '@/components/hr/JobPostingViewDialog';
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

/**
 * Base UI's <SelectValue> renders the raw value unless given a formatter
 * function, so a sentinel like "all" would show up literally as "all".
 * These maps turn each stored value into its label.
 */
const typeFilterLabels: Record<string, string> = {
  all: 'All Types',
  ...employmentTypeLabels,
};

const statusFilterLabels: Record<string, string> = {
  all: 'All Statuses',
  published: 'Published',
  draft: 'Draft',
};

/** "09:00:00" -> "9:00 AM" */
function to12Hour(value: string): string {
  const [rawHours, minutes] = value.split(':');
  const hours = Number(rawHours);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  // 0 -> 12 AM, 12 -> 12 PM, 13 -> 1 PM
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

/** "09:00:00" + "18:00:00" -> "9:00 AM - 6:00 PM" */
function formatWorkingHours(
  start: string | null,
  end: string | null
): string {
  if (!start || !end) return '--';
  return `${to12Hour(start)} - ${to12Hour(end)}`;
}

/**
 * The server sends salary_display when the viewer holds
 * job_postings.view_salary; fall back to the local formatter otherwise so the
 * column never renders a bare number without its "From"/"Up to" qualifier.
 */
function salaryCell(posting: JobPosting): string {
  if (!posting.send_salary_via_api) return 'Not published';
  const display =
    posting.salary_display ??
    formatSalaryDisplay(posting.min_salary, posting.max_salary);
  // Same PKR treatment the careers page uses, so HR sees what candidates do.
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
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(
    null
  );
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<JobPosting | null>(null);
  const [viewing, setViewing] = useState<JobPosting | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobPosting | null>(null);

  const { data, isLoading, isError } = useJobPostings({
    page,
    department_id: departmentFilter ?? undefined,
    employment_type: typeFilter !== 'all' ? typeFilter : undefined,
    is_published:
      statusFilter === 'all' ? undefined : statusFilter === 'published',
  });

  const deleteMutation = useDeleteJobPosting();
  const publishMutation = useSetJobPostingPublished();

  const postings = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.last_page ?? 1;
  const hasFilters =
    !!departmentFilter || typeFilter !== 'all' || statusFilter !== 'all';

  /**
   * `viewing` is the snapshot captured on row click. Publishing from inside the
   * detail dialog refetches the list, so re-read the posting from that fresh
   * data — otherwise the dialog would keep rendering the stale copy and its
   * badge would still say "Draft" after a successful publish. Falls back to the
   * snapshot so the dialog does not blank out if the posting leaves the current
   * page (e.g. publishing while the Draft filter is active).
   */
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
    // The menu item is already disabled in this case; belt and braces for the
    // keyboard path, where a stale row could still fire the handler.
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job Postings"
        description="Create job openings and publish them to the careers page"
        action={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus data-icon="inline-start" />
              Add Job Posting
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
            value={typeFilter}
            onValueChange={(val) => {
              setTypeFilter(val ?? 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Filter by employment type">
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
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val ?? 'all');
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Filter by publish status">
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
      </div>

      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
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
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : postings.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No job postings found"
          description={
            hasFilters
              ? 'No job postings match the current filters. Try adjusting your selection.'
              : 'Create your first job posting to advertise an opening on the careers page.'
          }
          action={
            canManage && !hasFilters ? (
              <Button onClick={openCreate}>
                <Plus data-icon="inline-start" />
                Add Job Posting
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
                    <TableHead>Job Title</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Employment Type</TableHead>
                    <TableHead>Work Mode</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Working Hours</TableHead>
                    <TableHead>Salary</TableHead>
                    <TableHead>Status</TableHead>
                    {showActions && (
                      <TableHead className="w-12">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {postings.map((posting) => (
                    <TableRow
                      key={posting.id}
                      // The whole row opens a read-only view. Keyboard users get
                      // the same affordance rather than being locked out of it.
                      role="button"
                      tabIndex={0}
                      aria-label={`View ${posting.title}`}
                      className="cursor-pointer"
                      onClick={() => setViewing(posting)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setViewing(posting);
                        }
                      }}
                    >
                      <TableCell className="font-medium">
                        {posting.title}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {posting.department?.name ?? '--'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {employmentTypeLabels[posting.employment_type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {workModeLabels[posting.work_mode]}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {posting.location ?? '--'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatWorkingHours(
                          posting.start_time,
                          posting.end_time
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {salaryCell(posting)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            posting.is_published ? 'default' : 'secondary'
                          }
                        >
                          {posting.is_published ? 'Published' : 'Draft'}
                        </Badge>
                      </TableCell>
                      {showActions && (
                        // Stop the row's view handler firing when someone is
                        // reaching for Edit / Publish / Delete.
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex items-center justify-center rounded-md size-8 hover:bg-muted text-muted-foreground"
                              aria-label={`Actions for ${posting.title}`}
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canEdit && (
                                <DropdownMenuItem
                                  onClick={() => openEdit(posting)}
                                >
                                  <Pencil data-icon="inline-start" />
                                  Edit
                                </DropdownMenuItem>
                              )}
                              {canPublish && (
                                <>
                                  <DropdownMenuItem
                                    // A future-dated posting is invisible on
                                    // the careers page, so publishing it would
                                    // only produce a badge that lies. The
                                    // server enforces this too — this just
                                    // stops the pointless round trip.
                                    disabled={
                                      !posting.is_published &&
                                      isFuturePostingDate(posting.posting_date)
                                    }
                                    onClick={() => togglePublished(posting)}
                                  >
                                    {posting.is_published ? (
                                      <>
                                        <EyeOff data-icon="inline-start" />
                                        Unpublish
                                      </>
                                    ) : (
                                      <>
                                        <Eye data-icon="inline-start" />
                                        Publish
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                  {!posting.is_published &&
                                    isFuturePostingDate(
                                      posting.posting_date
                                    ) && (
                                      // Without this the item is greyed out
                                      // with no clue why.
                                      <p className="px-2 pb-1 text-[11px] leading-snug text-muted-foreground max-w-48">
                                        Dated{' '}
                                        {formatPostingDate(
                                          posting.posting_date!
                                        )}
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
                                  <Trash2 data-icon="inline-start" />
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Showing {meta?.from ?? 0}&ndash;{meta?.to ?? 0} of{' '}
                {meta?.total ?? 0} job postings
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

      {/* Detail view, opened by clicking a row */}
      <JobPostingViewDialog
        // Hidden rather than discarded while the edit form is stacked on top,
        // so closing that form — by saving or cancelling — lands back on this
        // dialog. `viewing` is only cleared by an explicit Close. Editing from
        // the row menu leaves `viewing` null, so nothing reopens there.
        open={!!viewing && !dialogOpen}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
        posting={viewedPosting}
        onEdit={canEdit ? openEdit : undefined}
        onTogglePublished={canPublish ? togglePublished : undefined}
      />

      {/* Create/Edit Modal */}
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
