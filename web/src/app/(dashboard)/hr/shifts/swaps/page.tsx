'use client';

import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import {
  useShiftSwaps,
  useCreateShiftSwap,
  useApproveSwap,
  useRejectSwap,
  useCancelSwap,
} from '@/hooks/hr/use-shift-swaps';
import { useEmployees } from '@/hooks/hr/use-employees';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { ShiftSwapRequestCard } from '@/components/hr/ShiftSwapRequestCard';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const STATUS_TABS = ['all', 'pending', 'approved', 'rejected'] as const;

export default function ShiftSwapsPage() {
  const { user } = useAuthStore();
  const canManage =
    user?.role === 'owner' ||
    user?.role === 'admin' ||
    user?.role === 'manager';

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Swap request form state
  const [targetUserId, setTargetUserId] = useState('');
  const [swapDate, setSwapDate] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [empSearch, setEmpSearch] = useState('');

  const { data, isLoading, isError } = useShiftSwaps({
    status: statusFilter,
    page: currentPage,
  });
  const { data: employeesData } = useEmployees({
    search: empSearch || undefined,
    per_page: 50,
  });

  const createSwapMutation = useCreateShiftSwap();
  const approveSwapMutation = useApproveSwap();
  const rejectSwapMutation = useRejectSwap();
  const cancelSwapMutation = useCancelSwap();

  const swaps = data?.data ?? [];
  const totalPages = data?.last_page ?? 1;
  const employees = employeesData?.data ?? [];

  const handleCreateSwap = () => {
    if (!targetUserId || !swapDate) return;
    createSwapMutation.mutate(
      {
        target_user_id: targetUserId,
        swap_date: swapDate,
        reason: swapReason || null,
      },
      {
        onSuccess: () => {
          setCreateDialogOpen(false);
          setTargetUserId('');
          setSwapDate('');
          setSwapReason('');
        },
      }
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shift Swaps"
        description="Request and manage shift swap requests"
        action={
          <Button onClick={() => setCreateDialogOpen(true)}>
            <ArrowLeftRight data-icon="inline-start" />
            Request Swap
          </Button>
        }
      />

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {STATUS_TABS.map((status) => (
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

      {/* Swap List */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <ArrowLeftRight className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load swap requests
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : swaps.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No swap requests"
          description={
            statusFilter !== 'all'
              ? 'No swap requests match the selected filter.'
              : 'No shift swap requests have been made yet.'
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {swaps.map((swap) => (
              <ShiftSwapRequestCard
                key={swap.id}
                swap={swap}
                currentUserId={user?.id}
                onApprove={
                  canManage ? (id) => approveSwapMutation.mutate(id) : undefined
                }
                onReject={
                  canManage
                    ? (id, reviewer_note) =>
                        rejectSwapMutation.mutate({ id, reviewer_note })
                    : undefined
                }
                onCancel={(id) => cancelSwapMutation.mutate(id)}
                isApproving={approveSwapMutation.isPending}
                isRejecting={rejectSwapMutation.isPending}
                isCancelling={cancelSwapMutation.isPending}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center">
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
        </>
      )}

      {/* Create Swap Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Shift Swap</DialogTitle>
            <DialogDescription>
              Request to swap your shift with another team member.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div>
              <Label>Swap With</Label>
              <Select value={targetUserId} onValueChange={(val) => { if (val) setTargetUserId(val); }}>
                <SelectTrigger className="mt-1.5" aria-label="Select employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Search employees..."
                      value={empSearch}
                      onChange={(e) => setEmpSearch(e.target.value)}
                      className="mb-2"
                    />
                  </div>
                  <SelectGroup>
                    {employees
                      .filter((emp) => emp.id !== user?.id)
                      .map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {emp.name} ({emp.email})
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="swap-date">Swap Date</Label>
              <Input
                id="swap-date"
                type="date"
                className="mt-1.5"
                value={swapDate}
                onChange={(e) => setSwapDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="swap-reason">Reason (optional)</Label>
              <Textarea
                id="swap-reason"
                className="mt-1.5"
                placeholder="Why do you want to swap shifts?"
                value={swapReason}
                onChange={(e) => setSwapReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={createSwapMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateSwap}
              disabled={
                createSwapMutation.isPending || !targetUserId || !swapDate
              }
            >
              {createSwapMutation.isPending && (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              )}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
