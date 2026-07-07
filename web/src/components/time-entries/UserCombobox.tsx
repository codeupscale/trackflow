'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface TeamUser {
  id: string;
  name: string;
  email: string;
}

interface UserComboboxProps {
  /** Selected user id, or null for the placeholder / "no selection" state. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Only fetch the user list when the picker is actually usable. */
  enabled?: boolean;
}

/**
 * Team-member picker backed by `GET /users` — the same source the Time Entries and
 * Reports pages use for member selection (scoped server-side to what the caller may
 * see). Reused for on-behalf manual entries and the project-time report resource
 * filter. Clearable back to null.
 */
export function UserCombobox({
  value,
  onChange,
  placeholder = 'Select member',
  disabled = false,
  enabled = true,
}: UserComboboxProps) {
  const [open, setOpen] = useState(false);

  const { data: users, isLoading } = useQuery<TeamUser[]>({
    queryKey: ['team-users'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { per_page: 100 } });
      return res.data.users || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  const selected = users?.find((u) => u.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select member"
            className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
          />
        }
      >
        <span className="truncate">{selected ? selected.name : placeholder}</span>
        <div className="flex shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={0}
              className="rounded-sm opacity-70 hover:opacity-100"
              aria-label="Clear selection"
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
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--anchor-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search members..." />
          <CommandList>
            <CommandEmpty>{isLoading ? 'Loading...' : 'No members found.'}</CommandEmpty>
            <CommandGroup>
              {users?.map((u) => (
                <CommandItem
                  key={u.id}
                  value={`${u.name} ${u.email}`}
                  data-checked={value === u.id ? 'true' : undefined}
                  onSelect={() => {
                    onChange(u.id === value ? null : u.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{u.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{u.email}</span>
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
