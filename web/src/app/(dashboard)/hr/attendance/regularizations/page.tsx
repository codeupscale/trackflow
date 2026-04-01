'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { RegularizationCard } from '@/components/hr/RegularizationCard';
import { useRegularizations, useApproveRegularization, useRejectRegularization } from '@/hooks/hr/use-regularizations';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';

const STATUS_FILTERS = ['pending', 'approved', 'rejected'] as const;

export default function RegularizationsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isManager =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'owner';

  useEffect(() => {
    if (user && !isManager) {
      router.push('/hr/attendance');
    }
  }, [user, isManager, router]);

  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading, isError } = useRegularizations({
    status: statusFilter,
    page: currentPage,
  });

  const approveMutation = useApproveRegularization();
  const rejectMutation = useRejectRegularization();

  const regularizations = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;
  const pendingCount = statusFilter === 'pending' ? (data?.total ?? 0) : 0;

  const handleApprove = (id: string) => {
    approveMutation.mutate(id);
  };

  const handleReject = (id: string, review_note: string) => {
    rejectMutation.mutate({ id, review_note });
  };

  // Role gate
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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          Regularization Requests
          {pendingCount > 0 && statusFilter === 'pending' && (
            <Badge variant="destructive" className="text-xs">
              {pendingCount}
            </Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and manage attendance regularization requests
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {STATUS_FILTERS.map((status) => (
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
                <p className="text-muted-foreground font-medium">
                  Failed to load requests
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Please try again later.
                </p>
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
        ) : regularizations.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <ShieldAlert className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground font-medium">
                  No {statusFilter} regularization requests
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
            {regularizations.map((reg) => (
              <RegularizationCard
                key={reg.id}
                regularization={reg}
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
                    onClick={() =>
                      setCurrentPage((p) => Math.max(1, p - 1))
                    }
                    aria-disabled={currentPage === 1}
                    className={
                      currentPage === 1
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
                      Math.abs(p - currentPage) <= 1
                  )
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
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    aria-disabled={currentPage === totalPages}
                    className={
                      currentPage === totalPages
                        ? 'pointer-events-none opacity-50'
                        : 'cursor-pointer'
                    }
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
