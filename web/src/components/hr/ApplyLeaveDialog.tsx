'use client';

import { useEffect, useMemo } from 'react';
import { cn, codeBadgeColor, assignLeaveTypeColors, formatLeaveDays } from '@/lib/utils';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Upload } from 'lucide-react';
import { differenceInBusinessDays, format, subDays, parseISO } from 'date-fns';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';

import { useLeaveTypes } from '@/hooks/hr/use-leave-types';
import { useLeaveBalance } from '@/hooks/hr/use-leave-balance';
import { useApplyLeave } from '@/hooks/hr/use-apply-leave';
import {
  leaveRequestSchema,
  type LeaveRequestFormData,
} from '@/lib/validations/leave';

interface ApplyLeaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY: LeaveRequestFormData = {
  leave_type_id: '',
  start_date: '',
  end_date: '',
  reason: '',
  half_day: false,
  document: null,
};

export function ApplyLeaveDialog({ open, onOpenChange }: ApplyLeaveDialogProps) {
  const { data: leaveTypes } = useLeaveTypes();
  const { balances } = useLeaveBalance();

  // Same identity swatches as the balance cards, so a leave type looks the same
  // wherever it appears.
  const typeColors = useMemo(
    () => assignLeaveTypeColors((balances ?? []).map((b) => b.leave_type?.code ?? '')),
    [balances],
  );
  const applyMutation = useApplyLeave();

  const form = useForm<LeaveRequestFormData>({
    resolver: zodResolver(leaveRequestSchema) as any,
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(EMPTY);
  }, [open, form]);

  const watchedLeaveType = form.watch('leave_type_id');
  const watchedStart = form.watch('start_date');
  const watchedEnd = form.watch('end_date');
  const watchedHalfDay = form.watch('half_day');
  const watchedReason = form.watch('reason') ?? '';

  const minLeaveDate = format(subDays(new Date(), 7), 'yyyy-MM-dd');

  const selectedBalance = useMemo(() => {
    return balances?.find((b) => b.leave_type_id === watchedLeaveType);
  }, [balances, watchedLeaveType]);

  const calculatedDays = useMemo(() => {
    if (!watchedStart || !watchedEnd) return 0;
    try {
      const start = parseISO(watchedStart);
      const end = parseISO(watchedEnd);
      if (end < start) return 0;
      const days = differenceInBusinessDays(end, start) + 1;
      return watchedHalfDay ? 0.5 : days;
    } catch {
      return 0;
    }
  }, [watchedStart, watchedEnd, watchedHalfDay]);

  const onSubmit = (data: LeaveRequestFormData) => {
    applyMutation.mutate(data, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] grid-rows-[auto_1fr] overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-base">Apply for Leave</DialogTitle>
          <DialogDescription className="text-xs">
            Fill in the details below to submit a leave request.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col min-h-0 overflow-y-auto px-5 pb-5"
          >
            <div className="flex flex-col gap-3.5 pt-4">
              {/* ── Leave Details ── */}
              <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">
                Leave Details
              </p>

              <FormField
                control={form.control}
                name="leave_type_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Leave Type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="h-8 w-full text-sm">
                          <SelectValue placeholder="Select leave type">
                            {(value: string | null) => {
                              if (!value) return 'Select leave type';
                              const lt = leaveTypes?.find((t) => t.id === value);
                              return lt?.name ?? 'Select leave type';
                            }}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* Deliberately no day counts here — the list stays a
                            clean set of names. The balance for the chosen type
                            is shown in the summary strip below the field. */}
                        {leaveTypes?.filter((t) => t.is_active).map((type) => {
                          const swatch = typeColors[(type.code ?? '').toLowerCase()];
                          return (
                            <SelectItem key={type.id} value={type.id}>
                              <span className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    'inline-block h-2 w-2 rounded-full shrink-0',
                                    swatch?.bar ?? 'bg-primary',
                                  )}
                                />
                                <span>{type.name}</span>
                                {type.code && (
                                  <span
                                    className={cn(
                                      'inline-flex items-center rounded px-1.5 py-0.5 text-[0.55rem] font-semibold font-mono',
                                      codeBadgeColor(type.code),
                                    )}
                                  >
                                    {type.code}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedBalance && (
                <div className="rounded-lg bg-muted/50 border border-border/50 px-3 py-2 flex items-center justify-between">
                  <span className="text-[0.65rem] text-muted-foreground">Balance</span>
                  <span className="text-[0.65rem] font-medium tabular-nums">
                    {formatLeaveDays(
                      Number(selectedBalance.total_days) -
                        Number(selectedBalance.used_days) -
                        Number(selectedBalance.pending_days),
                    )}{' '}
                    remaining
                  </span>
                </div>
              )}

              {/* ── Schedule ── */}
              <div className="border-t border-border/50 pt-3.5 mt-1">
                <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground mb-3.5">
                  Schedule
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="start_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Start Date</FormLabel>
                      <FormControl>
                        <Controller
                          control={form.control}
                          name="start_date"
                          render={({ field: f }) => (
                            <DatePicker
                              value={f.value}
                              onChange={(val) => {
                                f.onChange(val);
                                if (val > watchedEnd) form.setValue('end_date', val);
                              }}
                              placeholder="Select date"
                              className="w-full"
                              minDate={minLeaveDate}
                              maxDate={watchedEnd}
                            />
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">End Date</FormLabel>
                      <FormControl>
                        <Controller
                          control={form.control}
                          name="end_date"
                          render={({ field: f }) => (
                            <DatePicker
                              value={f.value}
                              onChange={f.onChange}
                              placeholder="Select date"
                              className="w-full"
                              minDate={watchedStart || minLeaveDate}
                            />
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="half_day"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <FormLabel className="text-xs">Half Day</FormLabel>
                      <p className="text-[0.65rem] text-muted-foreground">
                        Apply for half a day only
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {calculatedDays > 0 && (
                <div className="rounded-lg bg-muted/50 border border-border/50 px-3 py-2 flex items-center justify-between">
                  <span className="text-[0.65rem] text-muted-foreground">Working days</span>
                  <span className="text-xs font-bold tabular-nums">
                    {calculatedDays} {calculatedDays === 1 ? 'day' : 'days'}
                  </span>
                </div>
              )}

              {/* ── Reason & Document ── */}
              <div className="border-t border-border/50 pt-3.5 mt-1">
                <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground mb-3.5">
                  Details
                </p>
              </div>

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs">Reason</FormLabel>
                      <span className="text-[0.6rem] text-muted-foreground tabular-nums">
                        {watchedReason.length}/1000
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Describe the reason for your leave..."
                        className="text-sm resize-none"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="document"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Supporting Document (optional)</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <Input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            field.onChange(file);
                          }}
                          className="flex-1 h-8 text-sm"
                        />
                        {field.value && (
                          <Badge variant="secondary" className="shrink-0 text-[0.6rem]">
                            <Upload className="size-3 mr-1" />
                            {(field.value as File).name}
                          </Badge>
                        )}
                      </div>
                    </FormControl>
                    <p className="text-[0.6rem] text-muted-foreground">
                      PDF, JPG, PNG, DOC, or DOCX. Max 5MB.
                    </p>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="sticky bottom-0 mt-4 gap-2 bg-popover pt-3 -mx-0.5 px-0.5 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={applyMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={applyMutation.isPending}>
                {applyMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
