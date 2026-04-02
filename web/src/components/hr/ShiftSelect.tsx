'use client';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useShifts } from '@/hooks/hr/use-shifts';

interface ShiftSelectProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ShiftSelect({
  value,
  onChange,
  placeholder = 'Select a shift',
  disabled,
}: ShiftSelectProps) {
  const { data, isLoading } = useShifts({ is_active: true });
  const shifts = data?.data ?? [];

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(val) => { if (val) onChange(val); }}
      disabled={disabled || isLoading}
    >
      <SelectTrigger aria-label="Select shift">
        <SelectValue placeholder={isLoading ? 'Loading...' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {shifts.map((shift) => (
            <SelectItem key={shift.id} value={shift.id}>
              <div className="flex items-center gap-2">
                <div
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: shift.color }}
                  aria-hidden="true"
                />
                <span>{shift.name}</span>
                <span className="text-xs text-muted-foreground">
                  {shift.start_time}&ndash;{shift.end_time}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
