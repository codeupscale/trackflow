'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { LeaveStatusBadge } from '@/components/hr/LeaveStatusBadge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { rejectLeaveSchema, type RejectLeaveFormData, type LeaveRequest } from '@/lib/validations/leave';
import { formatDate } from '@/lib/utils';

interface LeaveApprovalCardProps {
  request: LeaveRequest;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export function LeaveApprovalCard({
  request,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: LeaveApprovalCardProps) {
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RejectLeaveFormData>({
    resolver: zodResolver(rejectLeaveSchema) as any,
  });

  const userInitials = request.user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleReject = (data: RejectLeaveFormData) => {
    onReject(request.id, data.rejection_reason);
    setRejectDialogOpen(false);
    reset();
  };

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <Avatar className="size-10 shrink-0">
              <AvatarImage
                src={request.user.avatar_url || undefined}
                alt={request.user.name}
              />
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                {userInitials}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {request.user.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {request.user.email}
                  </p>
                </div>
                <LeaveStatusBadge status={request.status} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">Leave Type:</span>{' '}
                  <span className="font-medium text-foreground">{request.leave_type.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Days:</span>{' '}
                  <span className="font-medium text-foreground">
                    {request.days}{request.half_day ? ' (half day)' : ''}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">From:</span>{' '}
                  <span className="font-medium text-foreground">{formatDate(request.start_date)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">To:</span>{' '}
                  <span className="font-medium text-foreground">{formatDate(request.end_date)}</span>
                </div>
              </div>

              {request.reason && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground">Reason:</p>
                  <p className="text-xs text-foreground mt-0.5">{request.reason}</p>
                </div>
              )}

              {request.status === 'pending' && (
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => onApprove(request.id)}
                    disabled={isApproving}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {isApproving && <Loader2 className="mr-1 animate-spin" data-icon="inline-start" />}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={isRejecting}
                    className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    {isRejecting && <Loader2 className="mr-1 animate-spin" data-icon="inline-start" />}
                    Reject
                  </Button>
                </div>
              )}

              {request.rejection_reason && (
                <div className="mt-2 rounded-md bg-red-50 p-2 dark:bg-red-900/10">
                  <p className="text-xs text-red-700 dark:text-red-400">
                    <span className="font-medium">Rejection reason:</span> {request.rejection_reason}
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
              <DialogTitle>Reject Leave Request</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting {request.user.name}&apos;s leave request.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="rejection_reason">Rejection Reason</Label>
              <Textarea
                id="rejection_reason"
                placeholder="Enter the reason for rejection..."
                className="mt-1.5"
                {...register('rejection_reason')}
                aria-invalid={!!errors.rejection_reason}
              />
              {errors.rejection_reason && (
                <p className="mt-1 text-xs text-destructive">{errors.rejection_reason.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={isRejecting}>
                {isRejecting && <Loader2 className="mr-1 animate-spin" data-icon="inline-start" />}
                Reject Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
