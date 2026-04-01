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
import { differenceInBusinessDays, parseISO, format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/utils';

import { LeaveBalanceCard } from '@/components/hr/LeaveBalanceCard';
import { useLeaveTypes } from '@/hooks/hr/use-leave-types';
import { useLeaveBalance } from '@/hooks/hr/use-leave-balance';
import { useApplyLeave } from '@/hooks/hr/use-apply-leave';
import { leaveRequestSchema, type LeaveRequestFormData, type LeaveType } from '@/lib/validations/leave';

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
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/hr/leave')}
          aria-label="Back to My Leave"
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Apply for Leave</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
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
                'flex items-center gap-2 text-xs font-medium transition-colors',
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
                  'flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors',
                  currentStep === step.number
                    ? 'bg-primary text-primary-foreground'
                    : currentStep > step.number
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {currentStep > step.number ? (
                  <Check className="size-3.5" />
                ) : (
                  step.number
                )}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-px flex-1',
                  currentStep > step.number ? 'bg-green-500' : 'bg-border'
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
            <CardHeader>
              <CardTitle>Select Leave Type</CardTitle>
              <CardDescription>
                Choose the type of leave you would like to apply for
              </CardDescription>
            </CardHeader>
            <CardContent>
              {typesError ? (
                <p className="text-center text-muted-foreground py-4">
                  Failed to load leave types
                </p>
              ) : typesLoading || balancesLoading ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
              ) : !leaveTypes || leaveTypes.length === 0 ? (
                <div className="text-center py-6">
                  <Calendar className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground">No leave types available</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Please contact your administrator
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
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
                          <CardContent className="p-4">
                            <p className="text-sm font-medium">{type.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">
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
                <p className="mt-2 text-xs text-destructive">{errors.leave_type_id.message}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Date Selection */}
        {currentStep === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Select Dates</CardTitle>
              <CardDescription>
                Choose the start and end dates for your {selectedType?.name ?? 'leave'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="start_date">Start Date</Label>
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
                      <p className="text-xs text-destructive">{errors.start_date.message}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="end_date">End Date</Label>
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
                      <p className="text-xs text-destructive">{errors.end_date.message}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <Label htmlFor="half_day" className="text-sm">Half Day</Label>
                    <p className="text-xs text-muted-foreground">Apply for half a day only</p>
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
                  <div className="rounded-lg bg-muted p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Working days:</span>
                      <span className="text-lg font-bold text-foreground tabular-nums">
                        {calculatedDays} {calculatedDays === 1 ? 'day' : 'days'}
                      </span>
                    </div>
                    {selectedBalance && (
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">Remaining after this request:</span>
                        <span className="text-sm font-medium tabular-nums">
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
            <CardHeader>
              <CardTitle>Provide Details</CardTitle>
              <CardDescription>
                Enter a reason for your leave request and upload any supporting documents
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reason">Reason</Label>
                  <Textarea
                    id="reason"
                    placeholder="Describe the reason for your leave..."
                    {...form.register('reason')}
                    aria-invalid={!!errors.reason}
                  />
                  {errors.reason && (
                    <p className="text-xs text-destructive">{errors.reason.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {watchedValues.reason?.length ?? 0}/1000 characters
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="document">Supporting Document (optional)</Label>
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
                          className="flex-1"
                        />
                        {field.value && (
                          <Badge variant="secondary" className="shrink-0">
                            <Upload data-icon="inline-start" className="size-3" />
                            {(field.value as File).name}
                          </Badge>
                        )}
                      </div>
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
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
            <CardHeader>
              <CardTitle>Review Your Request</CardTitle>
              <CardDescription>
                Please verify all details before submitting
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Leave Type</p>
                    <p className="font-medium text-foreground">{selectedType?.name ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Type</p>
                    <Badge variant={selectedType?.type === 'paid' ? 'default' : 'secondary'}>
                      {selectedType?.type ?? '—'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Start Date</p>
                    <p className="font-medium text-foreground">{formatDate(watchedValues.start_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">End Date</p>
                    <p className="font-medium text-foreground">{formatDate(watchedValues.end_date)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Working Days</p>
                    <p className="font-medium text-foreground tabular-nums">
                      {calculatedDays} {calculatedDays === 1 ? 'day' : 'days'}
                      {watchedValues.half_day && ' (half day)'}
                    </p>
                  </div>
                  {watchedValues.document && (
                    <div>
                      <p className="text-xs text-muted-foreground">Document</p>
                      <p className="font-medium text-foreground truncate">
                        {(watchedValues.document as File).name}
                      </p>
                    </div>
                  )}
                </div>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reason</p>
                  <p className="text-sm text-foreground">{watchedValues.reason}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1}
          >
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            {currentStep < 4 ? (
              <Button type="button" onClick={handleNext}>
                Next
                <ArrowRight data-icon="inline-end" />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending && (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                )}
                Submit Request
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
