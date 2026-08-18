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

  const selectedShift = value ? shifts.find((s) => s.id === value) : null;

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(val) => { if (val) onChange(val); }}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className="h-9 text-sm" aria-label="Select shift">
        {selectedShift ? (
          <span className="flex items-center gap-2 truncate">
            <span
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: selectedShift.color }}
              aria-hidden="true"
            />
            {selectedShift.name}
          </span>
        ) : (
          <SelectValue placeholder={isLoading ? 'Loading...' : placeholder} />
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {shifts.map((shift) => (
            <SelectItem key={shift.id} value={shift.id}>
              <span className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: shift.color }}
                  aria-hidden="true"
                />
                {shift.name}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
