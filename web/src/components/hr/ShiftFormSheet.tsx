'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  shiftSchema,
  type ShiftFormData,
  type Shift,
  type DayOfWeek,
} from '@/lib/validations/shift';
import { useCreateShift, useUpdateShift } from '@/hooks/hr/use-shifts';
import { cn } from '@/lib/utils';

const DAYS_OF_WEEK: { value: DayOfWeek; label: string; short: string }[] = [
  { value: 'monday', label: 'Monday', short: 'Mon' },
  { value: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { value: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { value: 'thursday', label: 'Thursday', short: 'Thu' },
  { value: 'friday', label: 'Friday', short: 'Fri' },
  { value: 'saturday', label: 'Saturday', short: 'Sat' },
  { value: 'sunday', label: 'Sunday', short: 'Sun' },
];

interface ShiftFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift?: Shift | null;
}

export function ShiftFormSheet({ open, onOpenChange, shift }: ShiftFormDialogProps) {
  const isEditing = !!shift;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ShiftFormData>({
    resolver: zodResolver(shiftSchema) as any,
    defaultValues: {
      name: '',
      start_time: '09:00',
      end_time: '17:00',
      days_of_week: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      break_minutes: 0,
      grace_period_minutes: 0,
      allow_early_check_in: false,
      color: '#3B82F6',
      timezone: 'Asia/Karachi',
      description: null,
      is_active: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (shift) {
      reset({
        name: shift.name,
        start_time: shift.start_time.slice(0, 5),
        end_time: shift.end_time.slice(0, 5),
        days_of_week: shift.days_of_week,
        break_minutes: shift.break_minutes,
        grace_period_minutes: shift.grace_period_minutes,
        allow_early_check_in: shift.allow_early_check_in,
        color: shift.color,
        timezone: shift.timezone,
        description: shift.description,
        is_active: shift.is_active,
      });
    } else {
      reset({
        name: '',
        start_time: '09:00',
        end_time: '17:00',
        days_of_week: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        break_minutes: 0,
        grace_period_minutes: 0,
        allow_early_check_in: false,
        color: '#3B82F6',
        timezone: 'Asia/Karachi',
        description: null,
        is_active: true,
      });
    }
  }, [open, shift, reset]);

  const createMutation = useCreateShift();
  const updateMutation = useUpdateShift();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const daysValue = watch('days_of_week') ?? [];
  const colorValue = watch('color') ?? '#3B82F6';
  const allowEarlyValue = watch('allow_early_check_in') ?? false;
  const isActiveValue = watch('is_active') ?? true;

  const toggleDay = (day: DayOfWeek) => {
    const current = daysValue;
    if (current.includes(day)) {
      setValue('days_of_week', current.filter((d) => d !== day), { shouldValidate: true });
    } else {
      setValue('days_of_week', [...current, day], { shouldValidate: true });
    }
  };

  const onSubmit = (data: ShiftFormData) => {
    if (isEditing && shift) {
      updateMutation.mutate(
        { id: shift.id, ...data },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle className="text-base">
              {isEditing ? 'Edit Shift' : 'New Shift'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isEditing
                ? 'Update the shift details below.'
                : 'Create a new shift for your organization.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            {/* Name */}
            <div className="grid gap-1.5">
              <Label htmlFor="shift-name" className="text-xs">Name</Label>
              <Input
                id="shift-name"
                placeholder="e.g. Morning Shift"
                className="h-9 text-sm"
                {...register('name')}
                aria-invalid={!!errors.name}
              />
              {errors.name && <p className="text-[0.65rem] text-destructive">{errors.name.message}</p>}
            </div>

            {/* Start / End Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="shift-start" className="text-xs">Start Time</Label>
                <Input
                  id="shift-start"
                  type="time"
                  className="h-9 text-sm"
                  {...register('start_time')}
                  aria-invalid={!!errors.start_time}
                />
                {errors.start_time && <p className="text-[0.65rem] text-destructive">{errors.start_time.message}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shift-end" className="text-xs">End Time</Label>
                <Input
                  id="shift-end"
                  type="time"
                  className="h-9 text-sm"
                  {...register('end_time')}
                  aria-invalid={!!errors.end_time}
                />
                {errors.end_time && <p className="text-[0.65rem] text-destructive">{errors.end_time.message}</p>}
              </div>
            </div>

            {/* Working Days */}
            <div className="grid gap-1.5">
              <Label className="text-xs">Working Days</Label>
              <div className="flex items-center gap-1">
                {DAYS_OF_WEEK.map((day) => {
                  const selected = daysValue.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={cn(
                        'flex items-center justify-center rounded-md h-8 w-9 text-[0.6rem] font-semibold transition-colors',
                        selected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground',
                      )}
                      aria-pressed={selected}
                      title={day.label}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
              {errors.days_of_week && <p className="text-[0.65rem] text-destructive">{errors.days_of_week.message}</p>}
            </div>

            {/* Break / Grace */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="shift-break" className="text-xs">Break (min)</Label>
                <Input
                  id="shift-break"
                  type="number"
                  min={0}
                  max={120}
                  className="h-9 text-sm"
                  {...register('break_minutes')}
                  aria-invalid={!!errors.break_minutes}
                />
                {errors.break_minutes && <p className="text-[0.65rem] text-destructive">{errors.break_minutes.message}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="shift-grace" className="text-xs">Grace (min)</Label>
                <Input
                  id="shift-grace"
                  type="number"
                  min={0}
                  max={60}
                  className="h-9 text-sm"
                  {...register('grace_period_minutes')}
                  aria-invalid={!!errors.grace_period_minutes}
                />
                {errors.grace_period_minutes && <p className="text-[0.65rem] text-destructive">{errors.grace_period_minutes.message}</p>}
              </div>
            </div>

            {/* Color */}
            <div className="grid gap-1.5">
              <Label className="text-xs">Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  className="h-9 w-10 p-1 cursor-pointer shrink-0"
                  value={colorValue}
                  onChange={(e) => setValue('color', e.target.value)}
                />
                <Input
                  className="h-9 text-sm flex-1"
                  placeholder="#3B82F6"
                  {...register('color')}
                />
              </div>
              {errors.color && <p className="text-[0.65rem] text-destructive">{errors.color.message}</p>}
            </div>

            {/* Description */}
            <div className="grid gap-1.5">
              <Label htmlFor="shift-desc" className="text-xs">Description</Label>
              <Textarea
                id="shift-desc"
                rows={2}
                placeholder="Optional description..."
                className="text-sm resize-none"
                {...register('description')}
              />
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-xs font-medium">Allow early check-in</p>
                  <p className="text-[0.6rem] text-muted-foreground">Let employees check in before the shift start time</p>
                </div>
                <Switch
                  checked={allowEarlyValue}
                  onCheckedChange={(val) => setValue('allow_early_check_in', val)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-xs font-medium">Active</p>
                  <p className="text-[0.6rem] text-muted-foreground">Inactive shifts are hidden from selection</p>
                </div>
                <Switch
                  checked={isActiveValue}
                  onCheckedChange={(val) => setValue('is_active', val)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Shift'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { ShiftFormSheet as ShiftFormDialog };
