'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ShiftRoster } from '@/lib/validations/shift';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ShiftRosterCalendarProps {
  roster: ShiftRoster;
  weekStart: string;
}

function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function ShiftRosterCalendar({
  roster,
  weekStart,
}: ShiftRosterCalendarProps) {
  const weekDates = getWeekDates(weekStart);

  return (
    <div className="grid grid-cols-7 gap-2">
      {/* Day headers */}
      {DAY_LABELS.map((day, idx) => {
        const dateStr = weekDates[idx];
        const dayNum = dateStr ? new Date(dateStr + 'T00:00:00').getDate() : '';
        return (
          <div
            key={day}
            className="text-center text-xs font-medium text-muted-foreground pb-2 border-b border-border"
          >
            <div>{day}</div>
            <div className="text-foreground font-semibold text-sm">
              {dayNum}
            </div>
          </div>
        );
      })}

      {/* Day cells */}
      {weekDates.map((date) => {
        const dayEntries = roster[date] ?? [];

        return (
          <div key={date} className="min-h-[120px]">
            {dayEntries.length === 0 ? (
              <div className="text-[10px] text-muted-foreground p-2 text-center">
                No shifts
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {dayEntries.map((entry, idx) => (
                  <Card
                    key={`${entry.shift.id}-${idx}`}
                    className="border-l-2 overflow-hidden"
                    style={{ borderLeftColor: entry.shift.color }}
                  >
                    <CardContent className="p-2">
                      <p
                        className="text-[10px] font-semibold truncate"
                        style={{ color: entry.shift.color }}
                      >
                        {entry.shift.name}
                      </p>
                      <p className="text-[9px] text-muted-foreground tabular-nums">
                        {entry.shift.start_time.slice(0, 5)} &ndash;{' '}
                        {entry.shift.end_time.slice(0, 5)}
                      </p>
                      {entry.users.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {entry.users.slice(0, 3).map((user) => (
                            <Avatar
                              key={user.id}
                              className="size-5"
                              title={user.name}
                            >
                              <AvatarFallback className="bg-primary text-primary-foreground text-[8px] font-medium">
                                {getInitials(user.name)}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {entry.users.length > 3 && (
                            <span className="text-[9px] text-muted-foreground self-center">
                              +{entry.users.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
