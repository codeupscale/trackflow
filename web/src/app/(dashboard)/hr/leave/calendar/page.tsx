'use client';

import { useState } from 'react';
import { LeaveCalendar } from '@/components/hr/LeaveCalendar';

export default function LeaveCalendarPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const handleMonthChange = (newMonth: number, newYear: number) => {
    setMonth(newMonth);
    setYear(newYear);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Leave Calendar</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View team leave schedule at a glance
        </p>
      </div>

      {/* Calendar */}
      <LeaveCalendar month={month} year={year} onMonthChange={handleMonthChange} />
    </div>
  );
}
