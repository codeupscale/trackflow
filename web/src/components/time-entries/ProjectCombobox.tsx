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

export interface ProjectOption {
  id: string;
  name: string;
  color?: string | null;
}

/** Shared project list query — cached under a stable key across pickers. */
export function useProjectList() {
  return useQuery<ProjectOption[]>({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const res = await api.get('/projects', { params: { per_page: 100 } });
      return res.data.projects || res.data.data || (Array.isArray(res.data) ? res.data : []);
    },
    staleTime: 5 * 60_000,
  });
}

interface ProjectComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Single-select project picker backed by `GET /projects`. Clearable to null. */
export function ProjectCombobox({
  value,
  onChange,
  placeholder = 'Select project',
  disabled = false,
}: ProjectComboboxProps) {
  const [open, setOpen] = useState(false);
  const { data: projects, isLoading } = useProjectList();

  const selected = projects?.find((p) => p.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select project"
            className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground')}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.color && (
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span className="truncate">{selected ? selected.name : placeholder}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={0}
              className="rounded-sm opacity-70 hover:opacity-100"
              aria-label="Clear project"
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
          <CommandInput placeholder="Search projects..." />
          <CommandList>
            <CommandEmpty>{isLoading ? 'Loading...' : 'No projects found.'}</CommandEmpty>
            <CommandGroup>
              {projects?.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  data-checked={value === p.id ? 'true' : undefined}
                  onSelect={() => {
                    onChange(p.id === value ? null : p.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: p.color || '#6366f1' }}
                    />
                    <span className="truncate">{p.name}</span>
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
