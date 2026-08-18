'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Calendar,
  Loader2,
  CheckCircle2,
  XCircle,
  Hourglass,
  Clock,
  CheckCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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

import { useLeaveRequests } from '@/hooks/hr/use-leave-requests';
import { useApproveLeave, useRejectLeave } from '@/hooks/hr/use-leave-actions';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { formatDate } from '@/lib/utils';
import { rejectLeaveSchema, type RejectLeaveFormData, type LeaveRequest } from '@/lib/validations/leave';

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  pending: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Pending' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  rejected: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Rejected' },
  cancelled: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'Cancelled' },
};

const avatarColors = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export default function LeaveApprovalsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const isManager = hasPermission('leave.approve');

  const [statusFilter, setStatusFilter] = useState('pending');
  const [currentPage, setCurrentPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);

  useEffect(() => {
    if (user && !isManager) {
      router.push('/hr/leave');
    }
  }, [user, isManager, router]);

  const { data, isLoading, isError } = useLeaveRequests({
    status: statusFilter,
    page: currentPage,
  });
  const approveMutation = useApproveLeave();
  const rejectMutation = useRejectLeave();

  const rejectForm = useForm<RejectLeaveFormData>({
    resolver: zodResolver(rejectLeaveSchema) as any,
  });

  const requests = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;

  const stats = useMemo(() => {
    return {
      total: data?.total ?? 0,
    };
  }, [data]);

  const handleRejectSubmit = (formData: RejectLeaveFormData) => {
    if (!rejectTarget) return;
    rejectMutation.mutate(
      { id: rejectTarget.id, rejection_reason: formData.rejection_reason },
      { onSuccess: () => { setRejectTarget(null); rejectForm.reset(); } },
    );
  };

  const handleBulkApprove = async () => {
    const pendingRequests = requests.filter((r) => r.status === 'pending');
    for (const req of pendingRequests) {
      await approveMutation.mutateAsync(req.id);
    }
  };

  if (!user || !isManager) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const formatDays = (count: number) => {
    const n = Number(count);
    return n % 1 === 0 ? Math.round(n) : n;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leave Approvals</h1>
          <p className="text-xs text-muted-foreground">
            Review and manage team leave requests
          </p>
        </div>
        {statusFilter === 'pending' && requests.length > 1 && (
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={handleBulkApprove}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
            )}
            Approve All ({requests.filter((r) => r.status === 'pending').length})
          </Button>
        )}
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Calendar, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Pending', value: requests.filter((r) => r.status === 'pending').length, icon: Hourglass, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Approved', value: requests.filter((r) => r.status === 'approved').length, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Rejected', value: requests.filter((r) => r.status === 'rejected').length, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
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

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {['pending', 'approved', 'rejected', 'all'].map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => {
              setStatusFilter(status);
              setCurrentPage(1);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-[0.65rem] font-medium transition-colors capitalize',
              statusFilter === status
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={statusFilter === status}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <Calendar className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load requests</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-16" />
                ))}
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="h-7 w-7 rounded-full" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-5 w-14" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Calendar className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                No {statusFilter === 'all' ? '' : statusFilter} leave requests
              </p>
              <p className="text-xs text-muted-foreground">
                {statusFilter === 'pending'
                  ? 'All caught up! No pending requests to review.'
                  : 'No requests match the selected filter.'}
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Leave Type</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">From</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">To</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-center">Days</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((req) => {
                      const sd = statusDot[req.status] ?? statusDot.pending;
                      const initials = req.user.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2);

                      return (
                        <tr key={req.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={req.user.avatar_url || undefined} alt={req.user.name} />
                                <AvatarFallback className={`${getAvatarColor(req.user.name)} text-white text-[0.5rem] font-medium`}>
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="text-[0.75rem] font-medium truncate">{req.user.name}</p>
                                <p className="text-[0.6rem] text-muted-foreground truncate">{req.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem]">
                            {req.leave_type.name}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                            {formatDate(req.start_date)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                            {formatDate(req.end_date)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-center">
                            <span className="text-[0.75rem] font-semibold tabular-nums">
                              {formatDays(req.days_count)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                              {sd.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            {req.status === 'pending' ? (
                              <div className="inline-flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => approveMutation.mutate(req.id)}
                                  disabled={approveMutation.isPending}
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem] text-destructive hover:text-destructive"
                                  onClick={() => { setRejectTarget(req); rejectForm.reset(); }}
                                  disabled={rejectMutation.isPending}
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[0.65rem] text-muted-foreground/50">&mdash;</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[0.65rem] text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      aria-disabled={currentPage === 1}
                      className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
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
                            isActive={p === currentPage}
                            onClick={() => setCurrentPage(p)}
                            className="cursor-pointer"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={currentPage === totalPages}
                      className={currentPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}

      {/* Reject Dialog */}
      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!open) { setRejectTarget(null); rejectForm.reset(); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={rejectForm.handleSubmit(handleRejectSubmit)}>
            <DialogHeader>
              <DialogTitle className="text-base">Reject Leave Request</DialogTitle>
              <DialogDescription className="text-xs">
                Please provide a reason for rejecting{' '}
                <span className="font-medium text-foreground">{rejectTarget?.user.name}</span>&apos;s
                leave request.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 grid gap-1.5">
              <Label htmlFor="rejection_reason" className="text-xs">Reason</Label>
              <Textarea
                id="rejection_reason"
                rows={3}
                placeholder="Enter the reason for rejection..."
                className="text-sm resize-none"
                {...rejectForm.register('rejection_reason')}
                aria-invalid={!!rejectForm.formState.errors.rejection_reason}
              />
              {rejectForm.formState.errors.rejection_reason && (
                <p className="text-[0.65rem] text-destructive">
                  {rejectForm.formState.errors.rejection_reason.message}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRejectTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                Reject Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
