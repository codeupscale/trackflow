'use client';

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';

type FilterPreset = 'today' | 'yesterday' | 'week' | 'last-week' | 'this-month' | 'last-month' | 'custom';

interface DateFilterProps {
  filterPreset: FilterPreset;
  dateFrom: string;
  dateTo: string;
  rangeLabel: string;
  onPreset: (preset: FilterPreset) => void;
  onCustomApply: (from: string, to: string) => void;
}

export function DateFilter({
  filterPreset,
  dateFrom,
  dateTo,
  rangeLabel,
  onPreset,
  onCustomApply,
}: DateFilterProps) {
  const [open, setOpen] = useState(false);
  const [localFrom, setLocalFrom] = useState(dateFrom);
  const [localTo, setLocalTo] = useState(dateTo);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const presets: { key: FilterPreset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'week', label: 'This week' },
    { key: 'last-week', label: 'Last week' },
    { key: 'this-month', label: 'This month' },
    { key: 'last-month', label: 'Last month' },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) {
              setLocalFrom(dateFrom);
              setLocalTo(dateTo);
            }
            return next;
          });
        }}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Calendar className="h-4 w-4" />
        {rangeLabel}
        <ChevronDown className={`h-4 w-4 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-lg border border-border bg-card shadow-xl">
          <div className="p-2 space-y-1">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => { onPreset(p.key); setOpen(false); }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  filterPreset === p.key
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-t border-border mx-2" />

          <div className="p-3 space-y-3">
            <span className="text-xs text-muted-foreground font-medium">Custom range</span>
            <div className="flex items-center gap-2">
              <DatePicker
                value={localFrom}
                onChange={setLocalFrom}
                placeholder="From"
                className="flex-1 min-w-0"
              />
              <span className="text-muted-foreground shrink-0">--</span>
              <DatePicker
                value={localTo}
                onChange={setLocalTo}
                placeholder="To"
                className="flex-1 min-w-0"
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                onCustomApply(localFrom, localTo);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
