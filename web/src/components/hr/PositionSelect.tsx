'use client';

import { useState } from 'react';
import { ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { usePositions } from '@/hooks/hr/use-positions';

interface PositionSelectProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  departmentId?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function PositionSelect({
  value,
  onChange,
  departmentId,
  placeholder = 'Select position...',
  disabled = false,
}: PositionSelectProps) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = usePositions(
    departmentId ? { department_id: departmentId } : undefined
  );

  const positions = data?.data ?? [];
  const selected = positions.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select position"
            className={cn(
              'w-full justify-between font-normal',
              !value && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className="truncate">
          {selected ? selected.title : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={0}
              className="rounded-sm opacity-70 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onChange(null);
                }
              }}
              aria-label="Clear selection"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--anchor-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search positions..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No positions found.'}
            </CommandEmpty>
            <CommandGroup>
              {positions.map((pos) => (
                <CommandItem
                  key={pos.id}
                  value={pos.title}
                  onSelect={() => {
                    onChange(pos.id === value ? null : pos.id);
                    setOpen(false);
                  }}
                  data-checked={value === pos.id ? 'true' : undefined}
                >
                  <span className="truncate">{pos.title}</span>
                  {pos.department?.name && (
                    <span className="ml-auto text-muted-foreground text-xs">
                      {pos.department.name}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
