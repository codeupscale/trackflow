'use client';

import { useEffect, useState } from 'react';
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
import { useEmployees } from '@/hooks/hr/use-employees';
import type { EmployeeListItem } from '@/lib/validations/employee';

interface EmployeeSelectProps {
  /** The selected user's id (users table id), or null for "All employees". */
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** How many employees to request per search (page 1 only — search narrows it). */
  perPage?: number;
}

/**
 * Searchable employee combobox backed by the existing `useEmployees` hook. Search is
 * server-side (debounced) so it works over paginated directories without loading every
 * page — page 1 of the search result is enough to pick from. `value`/`onChange` speak
 * in the User id, which is what the check-in `user_id` filter param expects. On a
 * directory row that id is `EmployeeListItem.id` (the endpoint selects `users.id AS
 * id`); the list has NO `user_id` field, so comparing/selecting against `user_id`
 * would be `undefined === undefined` for every row — the exact bug this fixes.
 */
export function EmployeeSelect({
  value,
  onChange,
  placeholder = 'All employees',
  disabled = false,
  perPage = 20,
}: EmployeeSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Remember the picked employee so we can render its name even when it drops out of
  // the current search result set (the parent only stores the bare user_id).
  const [selected, setSelected] = useState<EmployeeListItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useEmployees({
    search: debouncedSearch || undefined,
    per_page: perPage,
    page: 1,
  });

  // Guard against rows without an id and dedupe by id — the directory can legitimately
  // return two distinct users with the same name (different accounts/emails), so keying
  // by a unique user id keeps exactly one row selectable per person.
  const employees = (data?.data ?? []).filter(
    (e, i, arr) => e.id != null && arr.findIndex((o) => o.id === e.id) === i
  );
  // Prefer the fresh row from the list, fall back to the remembered selection.
  const selectedRow =
    employees.find((e) => e.id === value) ??
    (selected?.id === value ? selected : null);

  const clear = () => {
    onChange(null);
    setSelected(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select employee"
            className={cn(
              'w-full justify-between font-normal',
              !value && 'text-muted-foreground'
            )}
          />
        }
      >
        <span className="truncate">
          {selectedRow ? selectedRow.name : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={0}
              className="rounded-sm opacity-70 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  clear();
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
        {/* Server-side search — disable cmdk's own filtering so it shows exactly what
            the API returned for the current query. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search employees..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No employees found.'}
            </CommandEmpty>
            <CommandGroup>
              {employees.map((emp) => (
                <CommandItem
                  key={emp.id}
                  value={emp.id}
                  onSelect={() => {
                    if (emp.id === value) {
                      clear();
                    } else {
                      onChange(emp.id);
                      setSelected(emp);
                    }
                    setOpen(false);
                  }}
                  data-checked={value === emp.id ? 'true' : undefined}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{emp.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {emp.email}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
