'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, CalendarDays, Repeat, CalendarCheck2, CalendarClock, Hash } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { LeaveCalendar } from '@/components/hr/LeaveCalendar';
import { usePermissionStore } from '@/stores/permission-store';
import { formatDate } from '@/lib/utils';
import api from '@/lib/api';

interface PublicHoliday {
  id: string;
  name: string;
  date: string;
  is_recurring: boolean;
}

export default function LeaveCalendarPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const { hasPermission } = usePermissionStore();
  const isAdmin = hasPermission('leave.manage_holidays');
  const queryClient = useQueryClient();

  // Add holiday form state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [holidayName, setHolidayName] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayRecurring, setHolidayRecurring] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PublicHoliday | null>(null);

  const handleMonthChange = (newMonth: number, newYear: number) => {
    setMonth(newMonth);
    setYear(newYear);
  };

  // Fetch all public holidays
  const { data: holidays, isLoading: holidaysLoading } = useQuery<PublicHoliday[]>({
    queryKey: ['public-holidays'],
    queryFn: async () => {
      const res = await api.get('/hr/public-holidays');
      const raw = res.data;
      return raw.data ?? raw.holidays ?? (Array.isArray(raw) ? raw : []);
    },
    enabled: isAdmin,
  });

  // Add holiday mutation
  const addHolidayMutation = useMutation({
    mutationFn: async (data: { name: string; date: string; is_recurring: boolean }) => {
      return api.post('/hr/public-holidays', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-holidays'] });
      queryClient.invalidateQueries({ queryKey: ['leave-calendar'] });
      toast.success('Public holiday added');
      setShowAddDialog(false);
      setHolidayName('');
      setHolidayDate('');
      setHolidayRecurring(false);
    },
    onError: () => toast.error('Failed to add holiday'),
  });

  // Delete holiday mutation
  const deleteHolidayMutation = useMutation({
    mutationFn: async (id: string) => {
      return api.delete(`/hr/public-holidays/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-holidays'] });
      queryClient.invalidateQueries({ queryKey: ['leave-calendar'] });
      toast.success('Public holiday removed');
      setDeleteTarget(null);
    },
    onError: () => toast.error('Failed to remove holiday'),
  });

  const handleAddHoliday = () => {
    if (!holidayName.trim() || !holidayDate) return;
    addHolidayMutation.mutate({
      name: holidayName.trim(),
      date: holidayDate,
      is_recurring: holidayRecurring,
    });
  };

  // Sort holidays by date
  const sortedHolidays = (holidays ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));

  // Group upcoming vs past
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Stats
  const stats = useMemo(() => {
    const total = sortedHolidays.length;
    const upcoming = sortedHolidays.filter((h) => h.date >= todayStr || h.is_recurring).length;
    const recurring = sortedHolidays.filter((h) => h.is_recurring).length;
    const oneTime = total - recurring;
    return { total, upcoming, recurring, oneTime };
  }, [sortedHolidays, todayStr]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leave Calendar</h1>
          <p className="text-xs text-muted-foreground">
            View team leave schedule at a glance
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" className="h-8 text-xs" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Public Holiday
          </Button>
        )}
      </div>

      {/* Calendar */}
      <LeaveCalendar month={month} year={year} onMonthChange={handleMonthChange} />

      {/* Public Holidays Section (Admin only) */}
      {isAdmin && (
        <>
          {/* Stats Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Holidays', value: stats.total, icon: Hash, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Upcoming', value: stats.upcoming, icon: CalendarClock, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
              { label: 'Recurring', value: stats.recurring, icon: Repeat, color: 'text-violet-500', bg: 'bg-violet-500/10' },
              { label: 'One-Time', value: stats.oneTime, icon: CalendarCheck2, color: 'text-amber-500', bg: 'bg-amber-500/10' },
            ].map((s) => (
              <Card key={s.label} className="border-border">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                      <s.icon className={`h-4 w-4 ${s.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                      <p className="text-base font-bold text-foreground tabular-nums leading-tight">{holidaysLoading ? '--' : s.value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Holidays Table */}
          <Card>
            <CardContent className="p-0">
              {holidaysLoading ? (
                <div className="flex flex-col">
                  <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-3 w-20" />
                    ))}
                  </div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-3.5 w-20" />
                      <Skeleton className="h-3.5 w-16" />
                      <Skeleton className="h-3.5 w-8 ml-auto" />
                    </div>
                  ))}
                </div>
              ) : sortedHolidays.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarDays className="size-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground font-medium">No public holidays configured</p>
                  <p className="text-xs text-muted-foreground mt-1">Add holidays to exclude them from working day counts</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Holiday</th>
                        <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Date</th>
                        <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Type</th>
                        <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedHolidays.map((holiday) => {
                        const isPast = holiday.date < todayStr && !holiday.is_recurring;
                        return (
                          <tr key={holiday.id} className={`border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors ${isPast ? 'opacity-50' : ''}`}>
                            <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground">
                              {holiday.name}
                            </td>
                            <td className="px-4 py-2.5 text-[0.75rem] text-muted-foreground">
                              {formatDate(holiday.date)}
                            </td>
                            <td className="px-4 py-2.5">
                              {holiday.is_recurring ? (
                                <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-violet-600 dark:text-violet-400">
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500" />
                                  Yearly
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-muted-foreground">
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                                  One-time
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTarget(holiday)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Add Holiday Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-base">Add Public Holiday</DialogTitle>
                <DialogDescription className="text-xs">
                  Add a holiday to exclude from working day counts.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="holiday-name" className="text-xs">Holiday Name</Label>
              <Input
                id="holiday-name"
                placeholder="e.g. Independence Day"
                value={holidayName}
                onChange={(e) => setHolidayName(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="holiday-date" className="text-xs">Date</Label>
              <Input
                id="holiday-date"
                type="date"
                value={holidayDate}
                onChange={(e) => setHolidayDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <Switch
                checked={holidayRecurring}
                onCheckedChange={setHolidayRecurring}
                id="holiday-recurring"
              />
              <Label htmlFor="holiday-recurring" className="cursor-pointer text-xs">
                Repeats every year (e.g. national holidays)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-8 text-xs" />}>
              Cancel
            </DialogClose>
            <Button
              className="h-8 text-xs"
              onClick={handleAddHoliday}
              disabled={!holidayName.trim() || !holidayDate || addHolidayMutation.isPending}
            >
              {addHolidayMutation.isPending && <Loader2 className="animate-spin h-3.5 w-3.5 mr-1" />}
              Add Holiday
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Holiday Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </div>
              <div>
                <DialogTitle className="text-base">Remove Public Holiday</DialogTitle>
                <DialogDescription className="text-xs">
                  Are you sure you want to remove &ldquo;{deleteTarget?.name}&rdquo; ({formatDate(deleteTarget?.date)})?
                  This will affect future leave day calculations.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-8 text-xs" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              className="h-8 text-xs"
              onClick={() => deleteTarget && deleteHolidayMutation.mutate(deleteTarget.id)}
              disabled={deleteHolidayMutation.isPending}
            >
              {deleteHolidayMutation.isPending && <Loader2 className="animate-spin h-3.5 w-3.5 mr-1" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
