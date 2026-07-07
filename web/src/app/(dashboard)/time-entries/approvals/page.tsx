'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { CheckCircle, ClipboardCheck, Loader2, XCircle } from 'lucide-react';

import { cn, formatDuration } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { PageLoading } from '@/components/page-loading';
import { UserCombobox } from '@/components/time-entries/UserCombobox';
import { ProjectCombobox } from '@/components/time-entries/ProjectCombobox';
import {
  usePendingApprovals,
  useApproveTimeEntry,
  useRejectTimeEntry,
} from '@/hooks/time-entries/use-pending-approvals';
import {
  rejectTimeEntrySchema,
  type RejectTimeEntryFormData,
  type PendingTimeEntry,
} from '@/lib/validations/time-entry';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';

export default function TimeEntryApprovalsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canApprove = hasPermission('time_entries.approve');

  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<PendingTimeEntry | null>(null);

  // Redirect unauthorized users once auth has resolved (avoids bouncing a manager
  // before the persisted permission store hydrates).
  useEffect(() => {
    if (user && !canApprove) {
      router.replace('/time');
    }
  }, [user, canApprove, router]);

  const { data, isLoading, isError } = usePendingApprovals(
    { user_id: userFilter, project_id: projectFilter, page },
    !!user && canApprove
  );
  const approveMutation = useApproveTimeEntry();
  const rejectMutation = useRejectTimeEntry();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RejectTimeEntryFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(rejectTimeEntrySchema) as any,
  });

  // Role gate: hold on a skeleton until auth resolves / redirect fires — no content flash.
  if (!user || !canApprove) {
    return <PageLoading />;
  }

  const entries = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;

  const submitReject = (values: RejectTimeEntryFormData) => {
    if (!rejectTarget) return;
    rejectMutation.mutate(
      { id: rejectTarget.id, rejection_reason: values.rejection_reason },
      {
        onSuccess: () => {
          setRejectTarget(null);
          reset({ rejection_reason: '' });
        },
      }
    );
  };

  const entryRange = (entry: PendingTimeEntry) => {
    const start = new Date(entry.started_at);
    if (!entry.ended_at) return format(start, 'HH:mm');
    return `${format(start, 'HH:mm')} - ${format(new Date(entry.ended_at), 'HH:mm')}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Time Entry Approvals"
        description="Review manual time submitted by your team."
      />

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex w-full flex-col gap-1.5 sm:w-64">
          <Label>Member</Label>
          <UserCombobox
            value={userFilter}
            onChange={(v) => {
              setUserFilter(v);
              setPage(1);
            }}
            placeholder="All members"
          />
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-64">
          <Label>Project</Label>
          <ProjectCombobox
            value={projectFilter}
            onChange={(v) => {
              setProjectFilter(v);
              setPage(1);
            }}
            placeholder="All projects"
          />
        </div>
      </div>

      {/* Body */}
      {isError ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <ClipboardCheck className="mx-auto mb-2 size-8 text-destructive/60" />
              <p className="font-medium text-muted-foreground">Failed to load pending entries</p>
              <p className="mt-1 text-sm text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No pending entries"
          description="All caught up! There are no manual time entries awaiting approval."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">
                            {entry.user?.name ?? '—'}
                          </span>
                          {entry.submitter && entry.submitter.id !== entry.user?.id && (
                            <span className="text-xs text-muted-foreground">
                              Submitted by {entry.submitter.name}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {entry.project ? (
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: entry.project.color || '#6366f1' }}
                            />
                            <span className="text-sm">{entry.project.name}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">No project</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground">
                          {format(new Date(entry.started_at), 'MMM d, yyyy')}
                        </span>
                        <div className="text-xs text-muted-foreground">{entryRange(entry)}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {formatDuration(entry.duration_seconds)}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        {entry.notes ? (
                          <span className="block truncate text-sm text-foreground" title={entry.notes}>
                            {entry.notes}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => approveMutation.mutate(entry.id)}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                            className="bg-green-600 text-white hover:bg-green-700"
                          >
                            {approveMutation.isPending ? (
                              <Loader2 className="animate-spin" data-icon="inline-start" />
                            ) : (
                              <CheckCircle data-icon="inline-start" />
                            )}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              reset({ rejection_reason: '' });
                              setRejectTarget(entry);
                            }}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                            className={cn(
                              'border-red-300 text-red-600 hover:bg-red-50',
                              'dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20'
                            )}
                          >
                            <XCircle data-icon="inline-start" />
                            Reject
                          </Button>
                        </div>
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Badge variant="secondary">{data?.total ?? entries.length} pending</Badge>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-disabled={page === 1}
                  className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink isActive className="cursor-default">
                  {page}
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-disabled={page >= totalPages}
                  className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      {/* Reject reason dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <form onSubmit={handleSubmit(submitReject)}>
            <DialogHeader>
              <DialogTitle>Reject Time Entry</DialogTitle>
              <DialogDescription>
                Provide a reason for rejecting {rejectTarget?.user?.name ?? 'this'}&apos;s entry.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="rejection_reason">Rejection reason</Label>
              <Textarea
                id="rejection_reason"
                placeholder="Explain why this entry is being rejected..."
                className="mt-1.5"
                {...register('rejection_reason')}
                aria-invalid={!!errors.rejection_reason}
              />
              {errors.rejection_reason && (
                <p className="mt-1 text-xs text-destructive">{errors.rejection_reason.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={rejectMutation.isPending}>
                {rejectMutation.isPending && (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                )}
                Reject Entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
