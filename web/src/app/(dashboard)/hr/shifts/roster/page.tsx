'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shift Roster"
        description="Weekly overview of shift assignments"
      />

      {/* Week Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPreviousWeek}
            aria-label="Previous week"
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium text-foreground min-w-[200px] text-center">
            {weekLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={goToNextWeek}
            aria-label="Next week"
          >
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToCurrentWeek}>
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
            className="w-fit"
            aria-label="Jump to week"
          />
        </div>
      </div>

      {/* Roster */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <CalendarRange className="size-10 text-destructive/60" />
              <p className="text-muted-foreground font-medium">
                Failed to load roster
              </p>
              <p className="text-sm text-muted-foreground">
                Please try again later.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !hasData ? (
        <EmptyState
          icon={CalendarRange}
          title="No shifts scheduled"
          description="No shift assignments found for this week. Assign users to shifts to see them here."
        />
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
