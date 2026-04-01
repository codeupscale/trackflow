'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Calendar, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogClose,
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

import { LeaveBalanceCard } from '@/components/hr/LeaveBalanceCard';
import { LeaveStatusBadge } from '@/components/hr/LeaveStatusBadge';
import { useLeaveBalance } from '@/hooks/hr/use-leave-balance';
import { useLeaveRequests } from '@/hooks/hr/use-leave-requests';
import { useCancelLeave } from '@/hooks/hr/use-leave-actions';
import { formatDate } from '@/lib/utils';
import type { LeaveRequest } from '@/lib/validations/leave';

export default function MyLeavePage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);

  const { balances, isLoading: balancesLoading, isError: balancesError } = useLeaveBalance();
  const { data: requestsData, isLoading: requestsLoading, isError: requestsError } = useLeaveRequests({ page: currentPage });
  const cancelMutation = useCancelLeave();

  const requests = requestsData?.data ?? [];
  const totalPages = requestsData?.last_page ?? 1;

  const handleCancel = () => {
    if (!cancelTarget) return;
    cancelMutation.mutate(cancelTarget.id, {
      onSuccess: () => setCancelTarget(null),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Leave</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View your leave balances and manage leave requests
          </p>
        </div>
        <Button render={<Link href="/hr/leave/apply" />}>
          <Plus data-icon="inline-start" />
          Apply for Leave
        </Button>
      </div>

      {/* Balances Section */}
      <section aria-label="Leave balances">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Leave Balances
        </h2>
        {balancesError ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">Failed to load leave balances</p>
            </CardContent>
          </Card>
        ) : balancesLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !balances || balances.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <div className="text-center">
                <Calendar className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">No leave types configured yet</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((balance) => (
              <LeaveBalanceCard key={balance.leave_type_id} balance={balance} />
            ))}
          </div>
        )}
      </section>

      {/* Requests Section */}
      <section aria-label="Leave requests">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          My Requests
        </h2>
        {requestsError ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">Failed to load leave requests</p>
            </CardContent>
          </Card>
        ) : requestsLoading ? (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Calendar className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground font-medium">No leave requests yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Click &quot;Apply for Leave&quot; to submit your first request.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {/* Header row - visible on md+ */}
              <div className="hidden md:grid md:grid-cols-6 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
                <span>Leave Type</span>
                <span>Date Range</span>
                <span className="text-center">Days</span>
                <span>Status</span>
                <span>Submitted</span>
                <span className="text-right">Actions</span>
              </div>

              {/* Data rows */}
              {requests.map((req, idx) => (
                <div key={req.id}>
                  {idx > 0 && <Separator />}
                  <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-6 md:gap-4 md:items-center">
                    <div className="font-medium text-sm text-foreground">
                      {req.leave_type.name}
                    </div>
                    <div className="text-xs text-muted-foreground md:text-sm">
                      {formatDate(req.start_date)} &mdash; {formatDate(req.end_date)}
                    </div>
                    <div className="text-xs text-foreground tabular-nums md:text-center md:text-sm">
                      {req.days_count}
                      {Number(req.days_count) === 0.5 && (
                        <Badge variant="secondary" className="ml-1 text-[10px]">
                          Half
                        </Badge>
                      )}
                    </div>
                    <div>
                      <LeaveStatusBadge status={req.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(req.created_at)}
                    </div>
                    <div className="flex justify-end col-span-2 md:col-span-1">
                      {req.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setCancelTarget(req)}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center border-t border-border p-4">
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
          </Card>
        )}
      </section>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Leave Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your {cancelTarget?.leave_type.name} request
              for {formatDate(cancelTarget?.start_date)} to {formatDate(cancelTarget?.end_date)}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Keep Request
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending && (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              )}
              Yes, Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
