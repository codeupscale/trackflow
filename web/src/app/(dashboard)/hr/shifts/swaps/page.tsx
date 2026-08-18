'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import {
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Loader2,
  MoreHorizontal,
  Plus,
  XCircle,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import {
  useShiftSwaps,
  useCreateShiftSwap,
  useApproveSwap,
  useRejectSwap,
  useCancelSwap,
} from '@/hooks/hr/use-shift-swaps';
import { useEmployees } from '@/hooks/hr/use-employees';
import { formatDate } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { cn } from '@/lib/utils';

const STATUS_TABS = ['all', 'pending', 'approved', 'rejected'] as const;

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-emerald-500',
  rejected: 'bg-red-500',
  cancelled: 'bg-blue-500',
};

const STATUS_TEXT: Record<string, string> = {
  pending: 'text-amber-600 dark:text-amber-400',
  approved: 'text-emerald-600 dark:text-emerald-400',
  rejected: 'text-red-600 dark:text-red-400',
  cancelled: 'text-blue-600 dark:text-blue-400',
};

const rejectNoteSchema = z.object({
  reviewer_note: z
    .string()
    .min(1, 'Review note is required')
    .max(500, 'Review note must be 500 characters or less'),
});

type RejectNoteFormData = z.infer<typeof rejectNoteSchema>;

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function ShiftSwapsPage() {
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('shifts.manage_swaps');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

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
  const total = data?.total ?? 0;
  const employees = employeesData?.data ?? [];

  // Derive stats from current data
  const pendingCount = swaps.filter((s) => s.status === 'pending').length;
  const approvedCount = swaps.filter((s) => s.status === 'approved').length;
  const rejectedCount = swaps.filter((s) => s.status === 'rejected').length;

  // Reject form
  const {
    register,
    handleSubmit,
    reset: resetRejectForm,
    formState: { errors: rejectErrors },
  } = useForm<RejectNoteFormData>({
    resolver: zodResolver(rejectNoteSchema) as any,
  });

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

  const openRejectDialog = (id: string) => {
    setRejectTargetId(id);
    setRejectDialogOpen(true);
  };

  const handleRejectSubmit = (data: RejectNoteFormData) => {
    if (!rejectTargetId) return;
    rejectSwapMutation.mutate(
      { id: rejectTargetId, reviewer_note: data.reviewer_note },
      {
        onSuccess: () => {
          setRejectDialogOpen(false);
          setRejectTargetId(null);
          resetRejectForm();
        },
      }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Shift Swaps</h1>
          <p className="text-xs text-muted-foreground">
            Request and manage shift swap requests
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={() => setCreateDialogOpen(true)}
        >
          <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
          Request Swap
        </Button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Total',
            value: total,
            icon: ArrowLeftRight,
            color: 'text-blue-500',
            bg: 'bg-blue-500/10',
          },
          {
            label: 'Pending',
            value: pendingCount,
            icon: Clock,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10',
          },
          {
            label: 'Approved',
            value: approvedCount,
            icon: CheckCircle2,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
          },
          {
            label: 'Rejected',
            value: rejectedCount,
            icon: XCircle,
            color: 'text-red-500',
            bg: 'bg-red-500/10',
          },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                    s.bg
                  )}
                >
                  <s.icon className={cn('h-4 w-4', s.color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
                    {s.label}
                  </p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">
                    {isLoading ? '--' : s.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
              'rounded-md px-3 py-1.5 text-[0.65rem] font-medium transition-colors capitalize',
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

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <ArrowLeftRight className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">
                Failed to load swap requests
              </p>
              <p className="text-xs text-muted-foreground">
                Please try again later.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-16" />
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0"
              >
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : swaps.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <ArrowLeftRight className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                No swap requests
              </p>
              <p className="text-xs text-muted-foreground">
                {statusFilter !== 'all'
                  ? 'No swap requests match the selected filter.'
                  : 'No shift swap requests have been made yet.'}
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
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        Requester
                      </th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        Swap With
                      </th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        Shifts
                      </th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        Date
                      </th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        Status
                      </th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        Requested
                      </th>
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {swaps.map((swap) => {
                      const isOwnRequest = user?.id === swap.requester_id;

                      return (
                        <tr
                          key={swap.id}
                          className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors group"
                        >
                          {/* Requester */}
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[0.55rem] font-medium shrink-0">
                                {swap.requester
                                  ? getInitials(swap.requester.name)
                                  : '??'}
                              </span>
                              <div className="min-w-0">
                                <p className="text-[0.75rem] font-medium truncate max-w-[140px]">
                                  {swap.requester?.name ?? 'Unknown'}
                                </p>
                                {swap.requester?.email && (
                                  <p className="text-[0.6rem] text-muted-foreground truncate max-w-[140px]">
                                    {swap.requester.email}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Target */}
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground text-[0.55rem] font-medium shrink-0">
                                {swap.target_user
                                  ? getInitials(swap.target_user.name)
                                  : '??'}
                              </span>
                              <div className="min-w-0">
                                <p className="text-[0.75rem] font-medium truncate max-w-[140px]">
                                  {swap.target_user?.name ?? 'Unknown'}
                                </p>
                                {swap.target_user?.email && (
                                  <p className="text-[0.6rem] text-muted-foreground truncate max-w-[140px]">
                                    {swap.target_user.email}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Shifts */}
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {swap.requester_shift && swap.target_shift ? (
                              <div className="flex items-center gap-1.5">
                                <span className="flex items-center gap-1 text-[0.7rem]">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor:
                                        swap.requester_shift.color,
                                    }}
                                  />
                                  <span className="truncate max-w-[70px]">
                                    {swap.requester_shift.name}
                                  </span>
                                </span>
                                <ArrowLeftRight className="size-2.5 text-muted-foreground shrink-0" />
                                <span className="flex items-center gap-1 text-[0.7rem]">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: swap.target_shift.color,
                                    }}
                                  />
                                  <span className="truncate max-w-[70px]">
                                    {swap.target_shift.name}
                                  </span>
                                </span>
                              </div>
                            ) : (
                              <span className="text-[0.75rem] text-muted-foreground">
                                --
                              </span>
                            )}
                          </td>

                          {/* Date */}
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-muted-foreground">
                            {formatDate(swap.swap_date)}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 text-[0.7rem] font-medium capitalize',
                                STATUS_TEXT[swap.status] ??
                                  'text-muted-foreground'
                              )}
                            >
                              <span
                                className={cn(
                                  'inline-block w-1.5 h-1.5 rounded-full',
                                  STATUS_DOT[swap.status] ??
                                    'bg-muted-foreground/40'
                                )}
                              />
                              {swap.status}
                            </span>
                            {swap.status !== 'pending' && swap.reviewer && (
                              <p className="text-[0.6rem] text-muted-foreground mt-0.5 truncate max-w-[140px]">
                                by {swap.reviewer.name}
                              </p>
                            )}
                          </td>

                          {/* Requested Date */}
                          <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] tabular-nums text-muted-foreground">
                            {formatDate(swap.created_at)}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-2.5 whitespace-nowrap text-right">
                            {swap.status === 'pending' &&
                            (canManage || isOwnRequest) ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className="inline-flex items-center justify-center rounded-md h-6 w-6 hover:bg-muted text-muted-foreground"
                                  aria-label="Swap actions"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {canManage && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          approveSwapMutation.mutate(swap.id)
                                        }
                                        disabled={
                                          approveSwapMutation.isPending
                                        }
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-500" />
                                        Approve
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() =>
                                          openRejectDialog(swap.id)
                                        }
                                        disabled={rejectSwapMutation.isPending}
                                      >
                                        <XCircle className="h-3.5 w-3.5 mr-2 text-red-500" />
                                        Reject
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                  {isOwnRequest && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        cancelSwapMutation.mutate(swap.id)
                                      }
                                      disabled={cancelSwapMutation.isPending}
                                      variant="destructive"
                                    >
                                      <XCircle className="h-3.5 w-3.5 mr-2" />
                                      Cancel Request
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : swap.reviewer_note ? (
                              <span
                                className="text-[0.6rem] text-muted-foreground truncate max-w-[120px] inline-block"
                                title={swap.reviewer_note}
                              >
                                {swap.reviewer_note}
                              </span>
                            ) : (
                              <span className="text-[0.6rem] text-muted-foreground">
                                --
                              </span>
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-[0.65rem] text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
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
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
                <ArrowLeftRight className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <div>
                <DialogTitle className="text-base">
                  Request Shift Swap
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Request to swap your shift with another team member.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-4 pt-2">
            <div>
              <Label className="text-xs">Swap With</Label>
              <Select
                value={targetUserId}
                onValueChange={(val) => {
                  if (val) setTargetUserId(val);
                }}
              >
                <SelectTrigger
                  className="mt-1.5 h-9 text-sm"
                  aria-label="Select employee"
                >
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Search employees..."
                      value={empSearch}
                      onChange={(e) => setEmpSearch(e.target.value)}
                      className="mb-2 h-8 text-xs"
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
              <Label htmlFor="swap-date" className="text-xs">
                Swap Date
              </Label>
              <Input
                id="swap-date"
                type="date"
                className="mt-1.5 h-9 text-sm"
                value={swapDate}
                onChange={(e) => setSwapDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="swap-reason" className="text-xs">
                Reason (optional)
              </Label>
              <Textarea
                id="swap-reason"
                className="mt-1.5 text-sm"
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
              size="sm"
              className="h-8 text-xs"
              onClick={() => setCreateDialogOpen(false)}
              disabled={createSwapMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              onClick={handleCreateSwap}
              disabled={
                createSwapMutation.isPending || !targetUserId || !swapDate
              }
            >
              {createSwapMutation.isPending && (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              )}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Swap Dialog */}
      <Dialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) {
            setRejectTargetId(null);
            resetRejectForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit(handleRejectSubmit)}>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                </div>
                <div>
                  <DialogTitle className="text-base">
                    Reject Swap Request
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    Please provide a reason for rejecting this swap request.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="reviewer_note" className="text-xs">
                Review Note
              </Label>
              <Textarea
                id="reviewer_note"
                placeholder="Enter the reason for rejection..."
                className="mt-1.5 text-sm"
                {...register('reviewer_note')}
                aria-invalid={!!rejectErrors.reviewer_note}
              />
              {rejectErrors.reviewer_note && (
                <p className="mt-1 text-xs text-destructive">
                  {rejectErrors.reviewer_note.message}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setRejectDialogOpen(false);
                  setRejectTargetId(null);
                  resetRejectForm();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                disabled={rejectSwapMutation.isPending}
              >
                {rejectSwapMutation.isPending && (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
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
