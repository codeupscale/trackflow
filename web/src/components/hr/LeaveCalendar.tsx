'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useLeaveCalendar } from '@/hooks/hr/use-leave-calendar';
import type { LeaveCalendarEntry, PublicHoliday } from '@/lib/validations/leave';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const LEAVE_TYPE_COLORS: Record<string, string> = {
  annual: 'bg-blue-500',
  sick: 'bg-red-500',
  personal: 'bg-purple-500',
  maternity: 'bg-pink-500',
  paternity: 'bg-indigo-500',
  bereavement: 'bg-gray-500',
  unpaid: 'bg-amber-500',
};

function getLeaveColor(code: string): string {
  return LEAVE_TYPE_COLORS[code.toLowerCase()] ?? 'bg-primary';
}

interface LeaveCalendarProps {
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
}

export function LeaveCalendar({ month, year, onMonthChange }: LeaveCalendarProps) {
  const { data, isLoading, isError } = useLeaveCalendar(month, year);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const monthName = new Date(year, month - 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Build a Map of holidays keyed by date string
  const holidayMap = useMemo(() => {
    const map = new Map<string, PublicHoliday>();
    if (data?.holidays) {
      for (const h of data.holidays) {
        // Normalize date: use the date string directly (backend already filters by month)
        // For recurring holidays, replace the year with the current calendar year
        const rawDate = typeof h.date === 'string' ? h.date.slice(0, 10) : h.date;
        const holidayDate = h.is_recurring
          ? `${year}-${rawDate.slice(5, 10)}`
          : rawDate;
        map.set(holidayDate, { ...h, date: holidayDate });
      }
    }
    return map;
  }, [data?.holidays, year]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();

    // Monday = 0, Sunday = 6
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;

    const calendarObj = data?.calendar ?? {};

    const cells: {
      date: string;
      day: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isWeekend: boolean;
      leaves: LeaveCalendarEntry[];
      holiday: PublicHoliday | undefined;
    }[] = [];

    // Fill leading empty cells (previous month)
    for (let i = 0; i < startDayOfWeek; i++) {
      const prevDate = new Date(year, month - 1, -startDayOfWeek + i + 1);
      const dateStr = formatDateStr(prevDate);
      const dayOfWeek = prevDate.getDay();
      cells.push({
        date: dateStr,
        day: prevDate.getDate(),
        isCurrentMonth: false,
        isToday: false,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        leaves: calendarObj[dateStr] ?? [],
        holiday: holidayMap.get(dateStr),
      });
    }

    // Fill current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, month - 1, d);
      const dayOfWeek = dateObj.getDay();
      cells.push({
        date: dateStr,
        day: d,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        leaves: calendarObj[dateStr] ?? [],
        holiday: holidayMap.get(dateStr),
      });
    }

    // Fill trailing cells to complete the grid
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let i = 1; i <= remaining; i++) {
        const nextDate = new Date(year, month, i);
        const dateStr = formatDateStr(nextDate);
        const dayOfWeek = nextDate.getDay();
        cells.push({
          date: dateStr,
          day: nextDate.getDate(),
          isCurrentMonth: false,
          isToday: false,
          isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
          leaves: calendarObj[dateStr] ?? [],
          holiday: holidayMap.get(dateStr),
        });
      }
    }

    return cells;
  }, [month, year, data?.calendar, holidayMap, todayStr]);

  const handlePrev = () => {
    if (month === 1) {
      onMonthChange(12, year - 1);
    } else {
      onMonthChange(month - 1, year);
    }
  };

  const handleNext = () => {
    if (month === 12) {
      onMonthChange(1, year + 1);
    } else {
      onMonthChange(month + 1, year);
    }
  };

  // Collect legend items from actual calendar data
  const legendItems = useMemo(() => {
    const calendarObj = data?.calendar ?? {};
    const seen = new Map<string, string>();
    for (const entries of Object.values(calendarObj)) {
      for (const entry of entries) {
        const code = entry.leave_type_code ?? entry.leave_type?.code;
        const name = entry.leave_type_name ?? entry.leave_type?.name;
        if (code && !seen.has(code)) {
          seen.set(code, name ?? code);
        }
      }
    }
    return Array.from(seen.entries()).map(([code, name]) => ({
      code,
      name,
      color: getLeaveColor(code),
    }));
  }, [data?.calendar]);

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <p className="text-muted-foreground font-medium">Failed to load calendar</p>
            <p className="text-sm text-muted-foreground mt-1">Please try again later.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrev}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <CardTitle className="text-base">{monthName}</CardTitle>
          <Button
            variant="outline"
            size="icon"
            onClick={handleNext}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-md" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Leave calendar">
              {WEEKDAYS.map((d, idx) => (
                <div
                  key={d}
                  className={cn(
                    'p-2 text-center text-xs font-medium',
                    idx >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground'
                  )}
                  role="columnheader"
                >
                  {d}
                </div>
              ))}
              {calendarDays.map((cell) => {
                const leaveCode = cell.leaves[0]?.leave_type_code ?? cell.leaves[0]?.leave_type?.code;
                return (
                  <div
                    key={cell.date}
                    role="gridcell"
                    aria-label={`${cell.date}${cell.leaves.length > 0 ? `, ${cell.leaves.length} leave(s)` : ''}${cell.holiday ? `, holiday: ${cell.holiday.name}` : ''}`}
                    className={cn(
                      'relative min-h-16 rounded-md border border-transparent p-1 text-xs transition-colors',
                      // Base text color
                      cell.isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40',
                      // Weekend styling — visible in both light and dark themes
                      cell.isWeekend && cell.isCurrentMonth && 'bg-muted/60 dark:bg-muted/40 text-muted-foreground',
                      cell.isWeekend && !cell.isCurrentMonth && 'bg-muted/30 dark:bg-muted/20',
                      // Holiday styling (overrides weekend) — stronger contrast
                      cell.holiday && cell.isCurrentMonth && 'bg-red-100/80 dark:bg-red-950/40 border-red-200 dark:border-red-900/50',
                      // Today highlight
                      cell.isToday && 'border-primary ring-1 ring-primary/30 bg-primary/5',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'inline-flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                          cell.isToday && 'bg-primary text-primary-foreground font-bold'
                        )}
                      >
                        {cell.day}
                      </span>
                      {cell.holiday && (
                        <span
                          className="size-1.5 rounded-full bg-red-500"
                          title={cell.holiday.name}
                          aria-label={`Holiday: ${cell.holiday.name}`}
                        />
                      )}
                    </div>
                    {/* Holiday name */}
                    {cell.holiday && cell.isCurrentMonth && (
                      <p className="mt-0.5 truncate text-[9px] font-medium text-red-600 dark:text-red-400">
                        {cell.holiday.name}
                      </p>
                    )}
                    {/* Leave entries */}
                    {cell.leaves.length > 0 && (
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {cell.leaves.slice(0, 3).map((leave, idx) => {
                          const code = leave.leave_type_code ?? leave.leave_type?.code ?? '';
                          const name = leave.user_name ?? leave.user?.name ?? '';
                          const typeName = leave.leave_type_name ?? leave.leave_type?.name ?? '';
                          return (
                            <div
                              key={idx}
                              className={cn(
                                'flex items-center gap-1 truncate rounded px-0.5',
                                leave.status === 'pending' ? 'opacity-60' : 'opacity-100'
                              )}
                              title={`${name} - ${typeName}${leave.half_day ? ' (half day)' : ''}${leave.status === 'pending' ? ' - Pending' : ''}`}
                            >
                              <span
                                className={cn('size-1.5 shrink-0 rounded-full', getLeaveColor(code))}
                              />
                              <span className="truncate text-[10px]">
                                {name.split(' ')[0]}
                              </span>
                            </div>
                          );
                        })}
                        {cell.leaves.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{cell.leaves.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <span className="text-xs font-medium text-muted-foreground">Legend:</span>
              {legendItems.map((item) => (
                <div key={item.code} className="flex items-center gap-1.5">
                  <span className={cn('size-2.5 rounded-full', item.color)} />
                  <span className="text-xs text-muted-foreground">{item.name}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-red-500" />
                <span className="text-xs text-muted-foreground">Public Holiday</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded bg-muted/50 border border-border" />
                <span className="text-xs text-muted-foreground">Weekend</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
