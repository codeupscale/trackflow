'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ShiftRosterCalendar } from '@/components/hr/ShiftRosterCalendar';
import { useShiftRoster } from '@/hooks/hr/use-shift-roster';

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split('T')[0];
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const yearFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric' });

  return `${fmt.format(start)} - ${fmt.format(end)}, ${yearFmt.format(end)}`;
}

export default function ShiftRosterPage() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));

  const { data: roster, isLoading, isError } = useShiftRoster(weekStart);

  const weekLabel = useMemo(() => formatWeekRange(weekStart), [weekStart]);

  const goToPreviousWeek = () => setWeekStart((w) => addWeeks(w, -1));
  const goToNextWeek = () => setWeekStart((w) => addWeeks(w, 1));
  const goToCurrentWeek = () => setWeekStart(getMonday(new Date()));

  const hasData =
    roster && Object.values(roster).some((entries) => entries.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Shift Roster</h1>
          <p className="text-xs text-muted-foreground">
            Weekly overview of shift assignments
          </p>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={goToPreviousWeek}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs font-medium text-foreground min-w-[180px] text-center tabular-nums">
            {weekLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={goToNextWeek}
            aria-label="Next week"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="h-8 text-xs"
            onClick={goToCurrentWeek}
          >
            Today
          </Button>
        </div>

        <div>
          <Input
            type="date"
            value={weekStart}
            onChange={(e) => {
              if (e.target.value) {
                setWeekStart(getMonday(new Date(e.target.value + 'T00:00:00')));
              }
            }}
            className="h-8 text-xs w-fit"
            aria-label="Jump to week"
          />
        </div>
      </div>

      {/* Roster */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <CalendarRange className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">
                Failed to load roster
              </p>
              <p className="text-xs text-muted-foreground">
                Please try again later.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-12 flex-1" />
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2 p-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="h-16 rounded-md" />
                  <Skeleton className="h-12 rounded-md" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !hasData ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <CalendarRange className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                No shifts scheduled
              </p>
              <p className="text-xs text-muted-foreground">
                No shift assignments found for this week. Assign users to shifts to see them here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <ShiftRosterCalendar
              roster={roster ?? {}}
              weekStart={weekStart}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
