'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShiftStatusBadge } from '@/components/hr/ShiftStatusBadge';
import { formatDate } from '@/lib/utils';
import type { ShiftSwapRequest } from '@/lib/validations/shift';

const rejectNoteSchema = z.object({
  reviewer_note: z
    .string()
    .min(1, 'Review note is required')
    .max(500, 'Review note must be 500 characters or less'),
});

type RejectNoteFormData = z.infer<typeof rejectNoteSchema>;

interface ShiftSwapRequestCardProps {
  swap: ShiftSwapRequest;
  onApprove?: (id: string) => void;
  onReject?: (id: string, reviewer_note: string) => void;
  onCancel?: (id: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  isCancelling?: boolean;
  currentUserId?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function ShiftSwapRequestCard({
  swap,
  onApprove,
  onReject,
  onCancel,
  isApproving,
  isRejecting,
  isCancelling,
  currentUserId,
}: ShiftSwapRequestCardProps) {
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RejectNoteFormData>({
    resolver: zodResolver(rejectNoteSchema) as any,
  });

  const handleReject = (data: RejectNoteFormData) => {
    onReject?.(swap.id, data.reviewer_note);
    setRejectDialogOpen(false);
    reset();
  };

  const isOwnRequest = currentUserId === swap.requester_id;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {/* Requester avatar */}
              <Avatar className="size-10 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                  {swap.requester
                    ? getInitials(swap.requester.name)
                    : '??'}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                {/* Requester and target */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {swap.requester?.name ?? 'Unknown'}
                  </span>
                  <ArrowLeftRight className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-foreground">
                    {swap.target_user?.name ?? 'Unknown'}
                  </span>
                </div>

                {/* Shift details */}
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Date:</span>
                    {formatDate(swap.swap_date)}
                  </div>

                  {swap.requester_shift && swap.target_shift && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1">
                        <span
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor: swap.requester_shift.color,
                          }}
                        />
                        {swap.requester_shift.name}
                      </span>
                      <ArrowLeftRight className="size-3 text-muted-foreground" />
                      <span className="flex items-center gap-1">
                        <span
                          className="size-2 rounded-full"
                          style={{
                            backgroundColor: swap.target_shift.color,
                          }}
                        />
                        {swap.target_shift.name}
                      </span>
                    </div>
                  )}

                  {swap.reason && (
                    <div className="mt-1">
                      <p className="text-xs text-muted-foreground">Reason:</p>
                      <p className="text-xs text-foreground mt-0.5">
                        {swap.reason}
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground">
                    Requested {formatDate(swap.created_at)}
                  </p>
                </div>

                {/* Actions for pending swaps */}
                {swap.status === 'pending' && (
                  <div className="mt-3 flex items-center gap-2">
                    {onApprove && (
                      <Button
                        size="sm"
                        onClick={() => onApprove(swap.id)}
                        disabled={isApproving}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {isApproving && (
                          <Loader2
                            className="animate-spin"
                            data-icon="inline-start"
                          />
                        )}
                        Approve
                      </Button>
                    )}
                    {onReject && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRejectDialogOpen(true)}
                        disabled={isRejecting}
                        className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        {isRejecting && (
                          <Loader2
                            className="animate-spin"
                            data-icon="inline-start"
                          />
                        )}
                        Reject
                      </Button>
                    )}
                    {isOwnRequest && onCancel && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onCancel(swap.id)}
                        disabled={isCancelling}
                      >
                        {isCancelling && (
                          <Loader2
                            className="animate-spin"
                            data-icon="inline-start"
                          />
                        )}
                        Cancel
                      </Button>
                    )}
                  </div>
                )}

                {/* Reviewer info */}
                {swap.status !== 'pending' && swap.reviewer && (
                  <div className="mt-2 rounded-md bg-muted p-2">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">
                        {swap.status === 'approved' ? 'Approved' : 'Rejected'}
                      </span>{' '}
                      by {swap.reviewer.name}
                      {swap.reviewed_at &&
                        ` on ${formatDate(swap.reviewed_at)}`}
                    </p>
                  </div>
                )}

                {swap.reviewer_note && (
                  <div className="mt-2 rounded-md bg-red-50 p-2 dark:bg-red-900/10">
                    <p className="text-xs text-red-700 dark:text-red-400">
                      <span className="font-medium">Review note:</span>{' '}
                      {swap.reviewer_note}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <ShiftStatusBadge status={swap.status} />
          </div>
        </CardContent>
      </Card>

      {/* Reject dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit(handleReject)}>
            <DialogHeader>
              <DialogTitle>Reject Swap Request</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this swap request.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="reviewer_note">Review Note</Label>
              <Textarea
                id="reviewer_note"
                placeholder="Enter the reason for rejection..."
                className="mt-1.5"
                {...register('reviewer_note')}
                aria-invalid={!!errors.reviewer_note}
              />
              {errors.reviewer_note && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.reviewer_note.message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={isRejecting}
              >
                {isRejecting && (
                  <Loader2
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                )}
                Reject Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
