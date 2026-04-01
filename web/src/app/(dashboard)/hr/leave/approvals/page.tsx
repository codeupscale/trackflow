'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Loader2, CheckCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { LeaveApprovalCard } from '@/components/hr/LeaveApprovalCard';
import { useLeaveRequests } from '@/hooks/hr/use-leave-requests';
import { useApproveLeave, useRejectLeave } from '@/hooks/hr/use-leave-actions';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';

export default function LeaveApprovalsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [currentPage, setCurrentPage] = useState(1);

  const { hasPermission } = usePermissionStore();
  const isManager = hasPermission('leave.approve');

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

  const requests = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;

  const pendingCount = useMemo(() => {
    if (statusFilter === 'pending') return data?.total ?? 0;
    return 0;
  }, [data, statusFilter]);

  // Role gate: show loading until auth resolves, redirect handled in useEffect above
  if (!user || !isManager) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          {!user ? 'Loading...' : 'Redirecting...'}
        </div>
      </div>
    );
  }

  const handleApprove = (id: string) => {
    approveMutation.mutate(id);
  };

  const handleReject = (id: string, reason: string) => {
    rejectMutation.mutate({ id, rejection_reason: reason });
  };

  const handleBulkApprove = async () => {
    const pendingRequests = requests.filter((r) => r.status === 'pending');
    for (const req of pendingRequests) {
      await approveMutation.mutateAsync(req.id);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              Leave Approvals
              {pendingCount > 0 && statusFilter === 'pending' && (
                <Badge variant="destructive" className="text-xs">
                  {pendingCount}
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review and manage team leave requests
            </p>
          </div>
        </div>
        {statusFilter === 'pending' && requests.length > 1 && (
          <Button
            variant="outline"
            onClick={handleBulkApprove}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <CheckCheck data-icon="inline-start" />
            )}
            Approve All ({requests.filter((r) => r.status === 'pending').length})
          </Button>
        )}
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
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize',
              statusFilter === status
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={statusFilter === status}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Request List */}
      <div>
          {isError ? (
            <Card>
              <CardContent className="py-8">
                <div className="text-center">
                  <ShieldAlert className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground font-medium">Failed to load requests</p>
                  <p className="text-sm text-muted-foreground mt-1">Please try again later.</p>
                </div>
              </CardContent>
            </Card>
          ) : isLoading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-24" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : requests.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <ShieldAlert className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground font-medium">
                    No {statusFilter === 'all' ? '' : statusFilter} leave requests
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {statusFilter === 'pending'
                      ? 'All caught up! No pending requests to review.'
                      : 'No requests match the selected filter.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {requests.map((request) => (
                <LeaveApprovalCard
                  key={request.id}
                  request={request}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  isApproving={approveMutation.isPending}
                  isRejecting={rejectMutation.isPending}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center pt-6">
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
                        <PaginationItem key={`ellipsis-${idx}`}>
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
                      )
                    )}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={currentPage === totalPages}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
      </div>
    </div>
  );
}
