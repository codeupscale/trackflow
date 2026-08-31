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

const NONE_VALUE = '__none__';

interface ShiftSelectProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Offer a "No shift" option; selecting it fires onClear instead of onChange. */
  allowNone?: boolean;
  onClear?: () => void;
}

export function ShiftSelect({
  value,
  onChange,
  placeholder = 'Select a shift',
  disabled,
  allowNone = false,
  onClear,
}: ShiftSelectProps) {
  const { data, isLoading } = useShifts({ is_active: true });
  const shifts = data?.data ?? [];

  const selectedShift = value ? shifts.find((s) => s.id === value) : null;

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(val) => {
        if (val === NONE_VALUE) {
          onClear?.();
        } else if (val) {
          onChange(val);
        }
      }}
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
        ) : value ? (
          // A value is selected but the shift list hasn't arrived yet — letting
          // SelectValue render here would print the raw uuid until it does.
          <span className="text-muted-foreground">Loading...</span>
        ) : (
          <SelectValue placeholder={isLoading ? 'Loading...' : placeholder} />
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {allowNone && (
            <SelectItem value={NONE_VALUE}>
              <span className="text-muted-foreground">No shift</span>
            </SelectItem>
          )}
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
