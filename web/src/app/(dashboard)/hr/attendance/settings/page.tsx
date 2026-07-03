'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Settings2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';

import {
  useAttendancePolicy,
  useUpdateAttendancePolicy,
} from '@/hooks/hr/use-check-in';
import {
  attendancePolicySchema,
  type AttendancePolicyFormData,
} from '@/lib/validations/attendance-policy';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';

// Trim HH:MM:SS → HH:MM for <input type="time"> values.
function toTimeInput(value: string | undefined): string {
  if (!value) return '';
  return value.slice(0, 5);
}

export default function AttendanceSettingsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('attendance.manage_policy');

  const { data: policy, isLoading, isError } = useAttendancePolicy();
  const updatePolicy = useUpdateAttendancePolicy();

  const form = useForm<AttendancePolicyFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(attendancePolicySchema) as any,
    defaultValues: {
      check_in_time: '',
      late_threshold: '',
      checkout_time: '',
      timezone: '',
      allow_early_check_in: false,
    },
  });

  const {
    control,
    handleSubmit,
    reset,
    register,
    formState: { errors, isDirty },
  } = form;

  // Hydrate the form once the policy loads.
  useEffect(() => {
    if (policy) {
      reset({
        check_in_time: toTimeInput(policy.check_in_time),
        late_threshold: toTimeInput(policy.late_threshold),
        checkout_time: toTimeInput(policy.checkout_time),
        timezone: policy.timezone,
        allow_early_check_in: policy.allow_early_check_in,
      });
    }
  }, [policy, reset]);

  // Role gate — hard early return, no content flash.
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          Loading...
        </div>
      </div>
    );
  }

  if (!canManage) {
    router.push('/hr/attendance');
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          Redirecting...
        </div>
      </div>
    );
  }

  const onSubmit = (data: AttendancePolicyFormData) => {
    updatePolicy.mutate(data);
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Attendance Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the organization&apos;s check-in and checkout rules.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4 text-muted-foreground" />
            Check-in Rules
          </CardTitle>
          <CardDescription>
            Times are in the organization timezone. The late threshold must be at or
            after the check-in time, and checkout must be after the late threshold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="text-sm text-muted-foreground py-4">
              Failed to load the attendance policy. Please refresh.
            </p>
          ) : isLoading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="check_in_time">Check-in time</Label>
                  <Input
                    id="check_in_time"
                    type="time"
                    aria-invalid={!!errors.check_in_time}
                    {...register('check_in_time')}
                  />
                  {errors.check_in_time && (
                    <p className="text-xs text-destructive">
                      {errors.check_in_time.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="late_threshold">Late threshold</Label>
                  <Input
                    id="late_threshold"
                    type="time"
                    aria-invalid={!!errors.late_threshold}
                    {...register('late_threshold')}
                  />
                  {errors.late_threshold && (
                    <p className="text-xs text-destructive">
                      {errors.late_threshold.message}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="checkout_time">Checkout time</Label>
                  <Input
                    id="checkout_time"
                    type="time"
                    aria-invalid={!!errors.checkout_time}
                    {...register('checkout_time')}
                  />
                  {errors.checkout_time && (
                    <p className="text-xs text-destructive">
                      {errors.checkout_time.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  placeholder="e.g. Asia/Karachi"
                  aria-invalid={!!errors.timezone}
                  {...register('timezone')}
                />
                <p className="text-xs text-muted-foreground">
                  IANA timezone identifier (e.g. Asia/Karachi, America/New_York).
                </p>
                {errors.timezone && (
                  <p className="text-xs text-destructive">
                    {errors.timezone.message}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="allow_early_check_in" className="text-sm">
                    Allow early check-in
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Let employees check in before the official check-in time.
                  </p>
                </div>
                <Controller
                  control={control}
                  name="allow_early_check_in"
                  render={({ field }) => (
                    <Switch
                      id="allow_early_check_in"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={updatePolicy.isPending || !isDirty}
                >
                  {updatePolicy.isPending && (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  )}
                  Save Policy
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
