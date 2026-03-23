'use client';

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

type FilterPreset = 'today' | 'week' | 'custom';

interface DateFilterProps {
  filterPreset: FilterPreset;
  dateFrom: string;
  dateTo: string;
  rangeLabel: string;
  onPreset: (preset: 'today' | 'week') => void;
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
    setLocalFrom(dateFrom);
    setLocalTo(dateTo);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700/50 hover:text-white transition-colors"
      >
        <Calendar className="h-4 w-4" />
        {rangeLabel}
        <ChevronDown className={`h-4 w-4 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          <div className="p-2 space-y-1">
            <button
              type="button"
              onClick={() => { onPreset('today'); setOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                filterPreset === 'today'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => { onPreset('week'); setOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                filterPreset === 'week'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              This week
            </button>
          </div>

          <div className="border-t border-slate-800 mx-2" />

          <div className="p-3 space-y-3">
            <span className="text-xs text-slate-400 font-medium">Custom range</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={localFrom}
                onChange={(e) => setLocalFrom(e.target.value)}
                className="h-8 flex-1 min-w-0 rounded-md border border-slate-700 bg-slate-800 px-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-slate-500 shrink-0">–</span>
              <input
                type="date"
                value={localTo}
                onChange={(e) => setLocalTo(e.target.value)}
                className="h-8 flex-1 min-w-0 rounded-md border border-slate-700 bg-slate-800 px-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
