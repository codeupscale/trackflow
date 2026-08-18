'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, isToday } from 'date-fns';
import {
  CheckCircle,
  ClipboardCheck,
  Clock,
  Hourglass,
  Loader2,
  Users,
  XCircle,
} from 'lucide-react';

import { cn, formatDuration } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
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

  /* --- Derived stats from current entries --- */
  const totalPending = data?.total ?? entries.length;
  const todayCount = entries.filter((e) => isToday(new Date(e.started_at))).length;
  const totalSeconds = entries.reduce((sum, e) => sum + (e.duration_seconds ?? 0), 0);
  const totalHours = (totalSeconds / 3600).toFixed(1);
  const uniqueMembers = new Set(entries.map((e) => e.user?.id).filter(Boolean)).size;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Time Entry Approvals</h1>
          <p className="text-xs text-muted-foreground">
            Review manual time submitted by your team
          </p>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Pending', value: isLoading ? '--' : totalPending, icon: Hourglass, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: "Today's Entries", value: isLoading ? '--' : todayCount, icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Unique Members', value: isLoading ? '--' : uniqueMembers, icon: Users, color: 'text-violet-500', bg: 'bg-violet-500/10' },
          { label: 'Total Hours', value: isLoading ? '--' : `${totalHours}h`, icon: ClipboardCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shrink-0', s.bg)}>
                  <s.icon className={cn('h-4 w-4', s.color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex w-full flex-col gap-1 sm:w-56">
          <Label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Member</Label>
          <UserCombobox
            value={userFilter}
            onChange={(v) => {
              setUserFilter(v);
              setPage(1);
            }}
            placeholder="All members"
          />
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-56">
          <Label className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Project</Label>
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
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <ClipboardCheck className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load pending entries</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-16" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-6 w-24 ml-auto" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No pending entries</p>
              <p className="text-xs text-muted-foreground">
                All caught up! There are no manual time entries awaiting approval.
              </p>
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Employee</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Project</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Date</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Duration</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Notes</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-[0.75rem] font-medium text-foreground">
                              {entry.user?.name ?? '—'}
                            </span>
                            {entry.submitter && entry.submitter.id !== entry.user?.id && (
                              <span className="text-[0.6rem] text-muted-foreground">
                                Submitted by {entry.submitter.name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {entry.project ? (
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-1.5 h-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: entry.project.color || '#6366f1' }}
                              />
                              <span className="text-[0.75rem]">{entry.project.name}</span>
                            </div>
                          ) : (
                            <span className="text-[0.75rem] text-muted-foreground/50">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="text-[0.75rem] text-foreground">
                            {format(new Date(entry.started_at), 'MMM d, yyyy')}
                          </span>
                          <div className="text-[0.6rem] text-muted-foreground tabular-nums">{entryRange(entry)}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          <span className="text-[0.75rem] font-semibold tabular-nums">
                            {formatDuration(entry.duration_seconds)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 max-w-[200px]">
                          {entry.notes ? (
                            <span className="block truncate text-[0.75rem] text-foreground" title={entry.notes}>
                              {entry.notes}
                            </span>
                          ) : (
                            <span className="text-[0.65rem] text-muted-foreground/50">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              className="h-6 px-2.5 text-[0.6rem] bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => approveMutation.mutate(entry.id)}
                              disabled={approveMutation.isPending || rejectMutation.isPending}
                            >
                              {approveMutation.isPending ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <CheckCircle className="h-3 w-3 mr-1" />
                              )}
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2.5 text-[0.6rem] text-destructive hover:text-destructive"
                              onClick={() => {
                                reset({ rejection_reason: '' });
                                setRejectTarget(entry);
                              }}
                              disabled={approveMutation.isPending || rejectMutation.isPending}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[0.65rem] text-muted-foreground">
                Page {page} of {totalPages} &middot; {data?.total ?? entries.length} pending
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
                      ),
                    )}
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
        </>
      )}

      {/* Reject reason dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit(submitReject)}>
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10 shrink-0">
                  <XCircle className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <DialogTitle className="text-base">Reject Time Entry</DialogTitle>
                </div>
              </div>
              <DialogDescription className="text-xs">
                Provide a reason for rejecting{' '}
                <span className="font-medium text-foreground">{rejectTarget?.user?.name ?? 'this'}</span>&apos;s entry.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 grid gap-1.5">
              <Label htmlFor="rejection_reason" className="text-xs">Rejection reason</Label>
              <Textarea
                id="rejection_reason"
                rows={3}
                placeholder="Explain why this entry is being rejected..."
                className="text-sm resize-none"
                {...register('rejection_reason')}
                aria-invalid={!!errors.rejection_reason}
              />
              {errors.rejection_reason && (
                <p className="text-[0.65rem] text-destructive">{errors.rejection_reason.message}</p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setRejectTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
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
