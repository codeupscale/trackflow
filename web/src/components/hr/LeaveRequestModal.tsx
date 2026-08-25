'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Pencil } from 'lucide-react';

import api from '@/lib/api';
import { cn, formatDate, formatLeaveDays, codeBadgeColor, assignLeaveTypeColors } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useLeaveTypes } from '@/hooks/hr/use-leave-types';
import type { LeaveRequest } from '@/lib/validations/leave';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
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

interface LeaveRequestModalProps {
  request: LeaveRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EditForm {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason: string;
}

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  pending: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Pending' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  rejected: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Rejected' },
  cancelled: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', label: 'Cancelled' },
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/50 last:border-0">
      <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground shrink-0 pt-0.5">
        {label}
      </span>
      <div className="text-xs text-foreground text-right min-w-0">{children}</div>
    </div>
  );
}

/**
 * Row-click modal for a leave request, shared by the Approvals tab and the
 * My Leave table. Everyone can VIEW any request their role lets them list; the
 * Edit button appears only on the viewer's OWN request while it is still
 * pending — that mirrors LeaveRequestPolicy::update, where approvers (owner
 * included) may never rewrite someone else's request.
 */
export function LeaveRequestModal({ request, open, onOpenChange }: LeaveRequestModalProps) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const { data: leaveTypes } = useLeaveTypes();
  const typeColors = useMemo(
    () => assignLeaveTypeColors((leaveTypes ?? []).map((t) => t.code ?? '')),
    [leaveTypes],
  );

  const isOwn = request?.user_id === user?.id;
  const canEdit = isOwn && request?.status === 'pending';

  const form = useForm<EditForm>({
    defaultValues: { leave_type_id: '', start_date: '', end_date: '', reason: '' },
  });

  // Re-arm on every open: back to the view pane, form primed from the request.
  useEffect(() => {
    if (!open || !request) return;
    setMode('view');
    form.reset({
      leave_type_id: request.leave_type_id,
      start_date: request.start_date.slice(0, 10),
      end_date: request.end_date.slice(0, 10),
      reason: request.reason,
    });
  }, [open, request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = useMutation({
    mutationFn: (data: EditForm) => api.put(`/hr/leave-requests/${request!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      toast.success('Leave request updated');
      // Return to the view pane so the user sees the saved result and closes
      // the modal themselves via the cross icon.
      setMode('view');
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ?? 'Failed to update leave request',
      );
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    if (!data.leave_type_id || !data.start_date || !data.end_date || !data.reason.trim()) {
      toast.error('All fields are required');
      return;
    }
    updateMutation.mutate(data);
  });

  if (!request) return null;

  const sd = STATUS_STYLE[request.status] ?? STATUS_STYLE.pending;
  const watchedStart = form.watch('start_date');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'view' ? `${request.leave_type?.name ?? 'Leave'} Request` : 'Edit Leave Request'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'view'
              ? isOwn ? 'Your leave request' : `Requested by ${request.user?.name ?? 'employee'}`
              : 'Update your request — it stays pending for approval.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'view' ? (
          <div className="flex flex-col">
            <div className="flex flex-col">
              <DetailRow label="Employee">
                <div className="flex flex-col items-end">
                  <span className="font-medium">{request.user?.name ?? '—'}</span>
                  {request.user?.email && (
                    <span className="text-[0.65rem] text-muted-foreground">{request.user.email}</span>
                  )}
                </div>
              </DetailRow>

              <DetailRow label="Type">
                <span className="inline-flex items-center gap-2">
                  <span>{request.leave_type?.name ?? '—'}</span>
                  {request.leave_type?.code && (
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-0.5 text-[0.55rem] font-semibold font-mono',
                        codeBadgeColor(request.leave_type.code),
                      )}
                    >
                      {request.leave_type.code}
                    </span>
                  )}
                </span>
              </DetailRow>

              <DetailRow label="Dates">
                {formatDate(request.start_date)}
                {request.start_date.slice(0, 10) !== request.end_date.slice(0, 10) && (
                  <> &rarr; {formatDate(request.end_date)}</>
                )}
              </DetailRow>

              <DetailRow label="Days">
                <span className="tabular-nums font-medium">{formatLeaveDays(request.days_count)}</span>
              </DetailRow>

              <DetailRow label="Status">
                <span className={cn('inline-flex items-center gap-1.5 text-[0.7rem] font-medium', sd.text)}>
                  <span className={cn('inline-block w-1.5 h-1.5 rounded-full', sd.dot)} />
                  {sd.label}
                </span>
              </DetailRow>

              <DetailRow label="Reason">
                <span className="whitespace-pre-wrap">{request.reason || '—'}</span>
              </DetailRow>

              {request.status === 'rejected' && request.rejection_reason && (
                <DetailRow label="Rejection">
                  <span className="whitespace-pre-wrap text-red-600 dark:text-red-400">
                    {request.rejection_reason}
                  </span>
                </DetailRow>
              )}
            </div>

            {canEdit && (
              <DialogFooter className="pt-4">
                <Button type="button" size="sm" onClick={() => setMode('edit')}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              </DialogFooter>
            )}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Leave Type</Label>
              <Controller
                control={form.control}
                name="leave_type_id"
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full h-8 text-sm" aria-label="Leave type">
                      {/* Base UI renders the RAW VALUE (the uuid) unless given a
                          mapping function — resolve it to the type's name. */}
                      <SelectValue placeholder="Select leave type">
                        {(value: string | null) => {
                          if (!value) return 'Select leave type';
                          return leaveTypes?.find((t) => t.id === value)?.name ?? 'Select leave type';
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(leaveTypes ?? []).filter((t) => t.is_active).map((type) => {
                          const swatch = typeColors[(type.code ?? '').toLowerCase()];
                          return (
                            <SelectItem key={type.id} value={type.id}>
                              <span className="flex items-center gap-2">
                                <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', swatch?.bar ?? 'bg-primary')} />
                                <span>{type.name}</span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Start Date</Label>
                <Controller
                  control={form.control}
                  name="start_date"
                  render={({ field }) => (
                    <DatePicker value={field.value} onChange={field.onChange} placeholder="Start date" />
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">End Date</Label>
                <Controller
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="End date"
                      minDate={watchedStart || undefined}
                    />
                  )}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lr-reason" className="text-xs">Reason</Label>
              <Textarea
                id="lr-reason"
                rows={3}
                className="text-sm resize-none"
                {...form.register('reason')}
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMode('view')}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
