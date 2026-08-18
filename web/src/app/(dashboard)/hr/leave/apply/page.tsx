'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Upload,
  Calendar,
} from 'lucide-react';
import { differenceInBusinessDays, parseISO } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils';

import { LeaveBalanceCard } from '@/components/hr/LeaveBalanceCard';
import { useLeaveTypes } from '@/hooks/hr/use-leave-types';
import { useLeaveBalance } from '@/hooks/hr/use-leave-balance';
import { useApplyLeave } from '@/hooks/hr/use-apply-leave';
import { leaveRequestSchema, type LeaveRequestFormData } from '@/lib/validations/leave';

const STEPS = [
  { number: 1, label: 'Leave Type' },
  { number: 2, label: 'Dates' },
  { number: 3, label: 'Details' },
  { number: 4, label: 'Review' },
];

export default function ApplyLeavePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);

  const { data: leaveTypes, isLoading: typesLoading, isError: typesError } = useLeaveTypes();
  const { balances, isLoading: balancesLoading } = useLeaveBalance();
  const applyMutation = useApplyLeave();

  const form = useForm<LeaveRequestFormData>({
    resolver: zodResolver(leaveRequestSchema) as any,
    defaultValues: {
      leave_type_id: '',
      start_date: '',
      end_date: '',
      reason: '',
      half_day: false,
      document: null,
    },
  });

  const { watch, setValue, trigger, formState: { errors } } = form;
  const watchedValues = watch();

  const selectedType = useMemo(() => {
    return leaveTypes?.find((t) => t.id === watchedValues.leave_type_id);
  }, [leaveTypes, watchedValues.leave_type_id]);

  const selectedBalance = useMemo(() => {
    return balances?.find((b) => b.leave_type_id === watchedValues.leave_type_id);
  }, [balances, watchedValues.leave_type_id]);

  const calculatedDays = useMemo(() => {
    if (!watchedValues.start_date || !watchedValues.end_date) return 0;
    try {
      const start = parseISO(watchedValues.start_date);
      const end = parseISO(watchedValues.end_date);
      if (end < start) return 0;
      const days = differenceInBusinessDays(end, start) + 1;
      return watchedValues.half_day ? 0.5 : days;
    } catch {
      return 0;
    }
  }, [watchedValues.start_date, watchedValues.end_date, watchedValues.half_day]);

  const canGoNext = async (): Promise<boolean> => {
    switch (currentStep) {
      case 1:
        return await trigger('leave_type_id');
      case 2:
        return await trigger(['start_date', 'end_date']);
      case 3:
        return await trigger('reason');
      default:
        return true;
    }
  };

  const handleNext = async () => {
    const valid = await canGoNext();
    if (valid && currentStep < 4) {
      setCurrentStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((s) => s - 1);
    }
  };

  const handleSubmit = form.handleSubmit((data: LeaveRequestFormData) => {
    applyMutation.mutate(data, {
      onSuccess: () => router.push('/hr/leave'),
    });
  });

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => router.push('/hr/leave')}
          aria-label="Back to My Leave"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Apply for Leave</h1>
          <p className="text-xs text-muted-foreground">
            Complete the steps below to submit a leave request
          </p>
        </div>
      </div>

      {/* Stepper */}
      <nav aria-label="Application steps" className="flex items-center gap-2">
        {STEPS.map((step, idx) => (
          <div key={step.number} className="flex items-center gap-2 flex-1">
            <button
              type="button"
              onClick={() => {
                if (step.number < currentStep) setCurrentStep(step.number);
              }}
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium transition-colors',
                currentStep === step.number
                  ? 'text-primary'
                  : currentStep > step.number
                    ? 'text-foreground cursor-pointer'
                    : 'text-muted-foreground'
              )}
              aria-current={currentStep === step.number ? 'step' : undefined}
              disabled={step.number > currentStep}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-[0.6rem] font-bold transition-colors',
                  currentStep === step.number
                    ? 'bg-primary text-primary-foreground'
                    : currentStep > step.number
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {currentStep > step.number ? (
                  <Check className="size-3" />
                ) : (
                  step.number
                )}
              </span>
              <span className="hidden sm:inline text-[0.65rem]">{step.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-px flex-1',
                  currentStep > step.number ? 'bg-emerald-500' : 'bg-border'
                )}
              />
            )}
          </div>
        ))}
      </nav>

      {/* Step Content */}
      <form onSubmit={handleSubmit}>
        {/* Step 1: Select Leave Type */}
        {currentStep === 1 && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-3">
                <p className="text-sm font-medium">Select Leave Type</p>
                <p className="text-xs text-muted-foreground">
                  Choose the type of leave you would like to apply for
                </p>
              </div>
              {typesError ? (
                <div className="flex flex-col items-center gap-2 py-6">
                  <Calendar className="h-8 w-8 text-destructive/60" />
                  <p className="text-sm text-muted-foreground">Failed to load leave types</p>
                </div>
              ) : typesLoading || balancesLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              ) : !leaveTypes || leaveTypes.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6">
                  <Calendar className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground font-medium">No leave types available</p>
                  <p className="text-xs text-muted-foreground">Please contact your administrator</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {leaveTypes.map((type) => {
                    const balance = balances?.find((b) => b.leave_type_id === type.id);
                    if (!balance) {
                      return (
                        <Card
                          key={type.id}
                          className={cn(
                            'cursor-pointer transition-all hover:border-primary/50',
                            watchedValues.leave_type_id === type.id && 'border-primary ring-2 ring-primary/20'
                          )}
                          onClick={() => setValue('leave_type_id', type.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setValue('leave_type_id', type.id);
                            }
                          }}
                          aria-pressed={watchedValues.leave_type_id === type.id}
                        >
                          <CardContent className="p-3">
                            <p className="text-xs font-medium">{type.name}</p>
                            <p className="text-[0.65rem] text-muted-foreground mt-0.5">
                              {type.days_per_year} days/year
                            </p>
                          </CardContent>
                        </Card>
                      );
                    }
                    return (
                      <LeaveBalanceCard
                        key={type.id}
                        balance={balance}
                        selected={watchedValues.leave_type_id === type.id}
                        onClick={() => setValue('leave_type_id', type.id)}
                      />
                    );
                  })}
                </div>
              )}
              {errors.leave_type_id && (
                <p className="mt-2 text-[0.65rem] text-destructive">{errors.leave_type_id.message}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Date Selection */}
        {currentStep === 2 && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-3">
                <p className="text-sm font-medium">Select Dates</p>
                <p className="text-xs text-muted-foreground">
                  Choose the start and end dates for your {selectedType?.name ?? 'leave'}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="start_date" className="text-xs">Start Date</Label>
                    <Controller
                      control={form.control}
                      name="start_date"
                      render={({ field }) => (
                        <DatePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select start date"
                          className="w-full"
                        />
                      )}
                    />
                    {errors.start_date && (
                      <p className="text-[0.65rem] text-destructive">{errors.start_date.message}</p>
                    )}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="end_date" className="text-xs">End Date</Label>
                    <Controller
                      control={form.control}
                      name="end_date"
                      render={({ field }) => (
                        <DatePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select end date"
                          className="w-full"
                        />
                      )}
                    />
                    {errors.end_date && (
                      <p className="text-[0.65rem] text-destructive">{errors.end_date.message}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <Label htmlFor="half_day" className="text-xs">Half Day</Label>
                    <p className="text-[0.65rem] text-muted-foreground">Apply for half a day only</p>
                  </div>
                  <Controller
                    control={form.control}
                    name="half_day"
                    render={({ field }) => (
                      <Switch
                        id="half_day"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>

                {calculatedDays > 0 && (
                  <div className="rounded-lg bg-muted/50 border border-border/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Working days:</span>
                      <span className="text-sm font-bold text-foreground tabular-nums">
                        {calculatedDays} {calculatedDays === 1 ? 'day' : 'days'}
                      </span>
                    </div>
                    {selectedBalance && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[0.65rem] text-muted-foreground">Remaining after this request:</span>
                        <span className="text-xs font-medium tabular-nums">
                          {selectedBalance.total_days - selectedBalance.used_days - selectedBalance.pending_days - calculatedDays} days
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Reason & Document */}
        {currentStep === 3 && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-3">
                <p className="text-sm font-medium">Provide Details</p>
                <p className="text-xs text-muted-foreground">
                  Enter a reason and upload any supporting documents
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="reason" className="text-xs">Reason</Label>
                    <span className="text-[0.6rem] text-muted-foreground tabular-nums">
                      {watchedValues.reason?.length ?? 0}/1000
                    </span>
                  </div>
                  <Textarea
                    id="reason"
                    rows={3}
                    placeholder="Describe the reason for your leave..."
                    className="text-sm resize-none"
                    {...form.register('reason')}
                    aria-invalid={!!errors.reason}
                  />
                  {errors.reason && (
                    <p className="text-[0.65rem] text-destructive">{errors.reason.message}</p>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="document" className="text-xs">Supporting Document (optional)</Label>
                  <Controller
                    control={form.control}
                    name="document"
                    render={({ field }) => (
                      <div className="flex items-center gap-2">
                        <Input
                          id="document"
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
                    )}
                  />
                  <p className="text-[0.6rem] text-muted-foreground">
                    PDF, JPG, PNG, DOC, or DOCX. Max 5MB.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Review */}
        {currentStep === 4 && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-3">
                <p className="text-sm font-medium">Review Your Request</p>
                <p className="text-xs text-muted-foreground">
                  Please verify all details before submitting
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">Leave Type</p>
                    <p className="text-xs font-medium text-foreground mt-0.5">{selectedType?.name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">Type</p>
                    <Badge variant={selectedType?.type === 'paid' ? 'default' : 'secondary'} className="mt-0.5 text-[0.6rem]">
                      {selectedType?.type ?? '—'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">Start Date</p>
                    <p className="text-xs font-medium text-foreground mt-0.5">{formatDate(watchedValues.start_date)}</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">End Date</p>
                    <p className="text-xs font-medium text-foreground mt-0.5">{formatDate(watchedValues.end_date)}</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">Working Days</p>
                    <p className="text-xs font-medium text-foreground tabular-nums mt-0.5">
                      {calculatedDays} {calculatedDays === 1 ? 'day' : 'days'}
                      {watchedValues.half_day && ' (half day)'}
                    </p>
                  </div>
                  {watchedValues.document && (
                    <div>
                      <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">Document</p>
                      <p className="text-xs font-medium text-foreground truncate mt-0.5">
                        {(watchedValues.document as File).name}
                      </p>
                    </div>
                  )}
                </div>
                <div className="border-t border-border/50 pt-3">
                  <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground mb-1">Reason</p>
                  <p className="text-xs text-foreground">{watchedValues.reason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleBack}
            disabled={currentStep === 1}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
          {currentStep < 4 ? (
            <Button type="button" size="sm" className="h-8 text-xs" onClick={handleNext}>
              Next
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              className="h-8 text-xs"
              disabled={applyMutation.isPending}
            >
              {applyMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Submit Request
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
