'use client';

import { Clock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Shift } from '@/lib/validations/shift';

const DAY_ABBREV: Record<string, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

interface ShiftCardProps {
  shift: Shift;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function ShiftCard({ shift, onEdit, onDelete }: ShiftCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="size-3 rounded-full shrink-0 mt-1.5"
              style={{ backgroundColor: shift.color }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {shift.name}
              </p>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                <Clock className="size-3 shrink-0" />
                <span className="tabular-nums">
                  {shift.start_time} &ndash; {shift.end_time}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={shift.is_active ? 'default' : 'secondary'}>
              {shift.is_active ? 'Active' : 'Inactive'}
            </Badge>

            {(onEdit || onDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex items-center justify-center rounded-md size-8 hover:bg-muted text-muted-foreground"
                  aria-label={`Actions for ${shift.name}`}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onEdit && (
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil data-icon="inline-start" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem variant="destructive" onClick={onDelete}>
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {shift.days_of_week.map((day) => (
            <span
              key={day}
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                'bg-muted text-muted-foreground'
              )}
            >
              {DAY_ABBREV[day] ?? day}
            </span>
          ))}
        </div>

        {(shift.break_minutes > 0 || shift.grace_period_minutes > 0) && (
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {shift.break_minutes > 0 && (
              <span>Break: {shift.break_minutes}m</span>
            )}
            {shift.grace_period_minutes > 0 && (
              <span>Grace: {shift.grace_period_minutes}m</span>
            )}
          </div>
        )}

        {shift.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
            {shift.description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
