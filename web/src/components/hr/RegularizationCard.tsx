'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { cn, formatDate } from '@/lib/utils';
import type { AttendanceRegularization } from '@/lib/validations/attendance';

const rejectReviewSchema = z.object({
  review_note: z
    .string()
    .min(1, 'Review note is required')
    .max(500, 'Review note must be 500 characters or less'),
});

type RejectReviewFormData = z.infer<typeof rejectReviewSchema>;

/* ── Attendance status dot ────────────────────────────────── */
const STATUS_DOT_CONFIG: Record<string, { dot: string; text: string; label: string }> = {
  present:  { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Present' },
  absent:   { dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400',         label: 'Absent' },
  half_day: { dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',     label: 'Half Day' },
  on_leave: { dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400',       label: 'On Leave' },
  weekend:  { dot: 'bg-slate-400',   text: 'text-slate-600 dark:text-slate-400',     label: 'Weekend' },
  holiday:  { dot: 'bg-sky-500',     text: 'text-sky-600 dark:text-sky-400',         label: 'Holiday' },
};

function StatusDot({ status }: { status: string }) {
  const fallback = { dot: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400', label: status };
  const c = STATUS_DOT_CONFIG[status] ?? fallback;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[0.7rem] font-medium', c.text)}>
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full', c.dot)} />
      {c.label}
    </span>
  );
}

/* ── Component ────────────────────────────────────────────── */
interface RegularizationCardProps {
  regularization: AttendanceRegularization;
  onApprove: (id: string) => void;
  onReject: (id: string, review_note: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export function RegularizationCard({
  regularization,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: RegularizationCardProps) {
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RejectReviewFormData>({
    resolver: zodResolver(rejectReviewSchema) as any,
  });

  const userInitials = regularization.user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleReject = (data: RejectReviewFormData) => {
    onReject(regularization.id, data.review_note);
    setRejectDialogOpen(false);
    reset();
  };

  return (
    <>
      <Card>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <Avatar className="size-8 shrink-0">
              <AvatarImage
                src={regularization.user.avatar_url || undefined}
                alt={regularization.user.name}
              />
              <AvatarFallback className="bg-primary text-primary-foreground text-[0.6rem] font-medium">
                {userInitials}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[0.75rem] font-medium text-foreground">
                    {regularization.user.name}
                  </p>
                  <p className="text-[0.65rem] text-muted-foreground">
                    {regularization.user.email}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 flex flex-col gap-1.5">
                <div className="text-[0.65rem] text-muted-foreground">
                  <span className="font-medium text-foreground">Date:</span>{' '}
                  {formatDate(regularization.attendance_record.date)}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <StatusDot status={regularization.current_status} />
                  <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                  <StatusDot status={regularization.requested_status} />
                </div>

                <div className="mt-0.5">
                  <p className="text-[0.65rem] text-muted-foreground">Reason:</p>
                  <p className="text-[0.7rem] text-foreground mt-0.5">
                    {regularization.reason}
                  </p>
                </div>

                <p className="text-[0.6rem] text-muted-foreground">
                  Requested {formatDate(regularization.created_at)}
                </p>
              </div>

              {regularization.status === 'pending' && (
                <div className="mt-2.5 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => onApprove(regularization.id)}
                    disabled={isApproving}
                    className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                  >
                    {isApproving && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={isRejecting}
                    className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    {isRejecting && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    Reject
                  </Button>
                </div>
              )}

              {regularization.status !== 'pending' &&
                regularization.reviewer && (
                  <div className="mt-2 rounded-md bg-muted p-2">
                    <p className="text-[0.65rem] text-muted-foreground">
                      <span className="font-medium">
                        {regularization.status === 'approved'
                          ? 'Approved'
                          : 'Rejected'}
                      </span>{' '}
                      by {regularization.reviewer.name}
                      {regularization.reviewed_at &&
                        ` on ${formatDate(regularization.reviewed_at)}`}
                    </p>
                  </div>
                )}

              {regularization.review_note && (
                <div className="mt-2 rounded-md bg-red-50 p-2 dark:bg-red-900/10">
                  <p className="text-[0.65rem] text-red-700 dark:text-red-400">
                    <span className="font-medium">Review note:</span>{' '}
                    {regularization.review_note}
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit(handleReject)}>
            <DialogHeader>
              <DialogTitle>Reject Regularization</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting{' '}
                {regularization.user.name}&apos;s regularization request.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="review_note" className="text-xs">Review Note</Label>
              <Textarea
                id="review_note"
                placeholder="Enter the reason for rejection..."
                className="mt-1.5"
                {...register('review_note')}
                aria-invalid={!!errors.review_note}
              />
              {errors.review_note && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.review_note.message}
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
              <Button type="submit" variant="destructive" disabled={isRejecting}>
                {isRejecting && (
                  <Loader2
                    className="size-3.5 animate-spin"
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
