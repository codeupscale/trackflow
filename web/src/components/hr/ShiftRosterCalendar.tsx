'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ShiftRoster } from '@/lib/validations/shift';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const avatarColors = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
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

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().split('T')[0];
}

interface ShiftRosterCalendarProps {
  roster: ShiftRoster;
  weekStart: string;
}

export function ShiftRosterCalendar({ roster, weekStart }: ShiftRosterCalendarProps) {
  const weekDates = getWeekDates(weekStart);

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {DAY_LABELS.map((day, idx) => {
        const dateStr = weekDates[idx];
        const dayNum = dateStr ? new Date(dateStr + 'T00:00:00').getDate() : '';
        const today = dateStr ? isToday(dateStr) : false;

        return (
          <div key={day} className="text-center pb-2 border-b border-border/50">
            <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">
              {day}
            </p>
            <p className={cn(
              'text-sm font-semibold tabular-nums mt-0.5',
              today
                ? 'text-primary'
                : 'text-foreground',
            )}>
              {dayNum}
            </p>
          </div>
        );
      })}

      {weekDates.map((date) => {
        const dayEntries = roster[date] ?? [];

        return (
          <div key={date} className="min-h-[100px]">
            {dayEntries.length === 0 ? (
              <div className="flex items-center justify-center h-[100px]">
                <span className="text-[0.6rem] text-muted-foreground/40">No shifts</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1 pt-1">
                {dayEntries.map((entry, idx) => (
                  <div
                    key={`${entry.shift.id}-${idx}`}
                    className="rounded-md border border-border/40 p-1.5 border-l-2"
                    style={{ borderLeftColor: entry.shift.color }}
                  >
                    <p
                      className="text-[0.6rem] font-semibold truncate leading-tight"
                      style={{ color: entry.shift.color }}
                    >
                      {entry.shift.name}
                    </p>
                    <p className="text-[0.55rem] text-muted-foreground tabular-nums mt-0.5">
                      {entry.shift.start_time.slice(0, 5)} &ndash; {entry.shift.end_time.slice(0, 5)}
                    </p>
                    {entry.users.length > 0 && (
                      <div className="flex items-center gap-0.5 mt-1">
                        {entry.users.slice(0, 3).map((user) => (
                          <Tooltip key={user.id}>
                            <TooltipTrigger
                              render={<span />}
                              className="inline-flex"
                              tabIndex={0}
                            >
                              <Avatar className="size-4">
                                <AvatarFallback
                                  className={`${getAvatarColor(user.name)} text-white text-[6px] font-medium`}
                                >
                                  {getInitials(user.name)}
                                </AvatarFallback>
                              </Avatar>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p className="text-xs">{user.name}</p>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                        {entry.users.length > 3 && (
                          <span className="text-[0.5rem] text-muted-foreground ml-0.5">
                            +{entry.users.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
