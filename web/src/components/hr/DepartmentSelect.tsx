'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
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
import { useDepartments } from '@/hooks/hr/use-departments';

interface DepartmentSelectProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeId?: string;
}

export function DepartmentSelect({
  value,
  onChange,
  placeholder = 'Select department...',
  disabled = false,
  excludeId,
}: DepartmentSelectProps) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useDepartments({ is_active: true });

  const departments = (data?.data ?? []).filter(
    (d) => !excludeId || d.id !== excludeId
  );
  const selected = departments.find((d) => d.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select department"
            className={cn(
              'w-full justify-between font-normal',
              !value && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className="truncate">
          {selected ? selected.name : placeholder}
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
          <CommandInput placeholder="Search departments..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No departments found.'}
            </CommandEmpty>
            <CommandGroup>
              {departments.map((dept) => (
                <CommandItem
                  key={dept.id}
                  value={dept.name}
                  onSelect={() => {
                    onChange(dept.id === value ? null : dept.id);
                    setOpen(false);
                  }}
                  data-checked={value === dept.id ? 'true' : undefined}
                >
                  <span className="truncate">{dept.name}</span>
                  {dept.code && (
                    <span className="ml-auto text-muted-foreground text-xs">
                      {dept.code}
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
