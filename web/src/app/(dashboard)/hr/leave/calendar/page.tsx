'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, CalendarDays, Repeat } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { useAuthStore } from '@/stores/auth-store';
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
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leave Calendar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View team leave schedule at a glance
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus data-icon="inline-start" />
            Add Public Holiday
          </Button>
        )}
      </div>

      {/* Calendar */}
      <LeaveCalendar month={month} year={year} onMonthChange={handleMonthChange} />

      {/* Public Holidays List (Admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="size-4" />
              Public Holidays ({sortedHolidays.length})
            </CardTitle>
            <CardDescription>
              Manage organization public holidays. These days are excluded from leave day calculations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {holidaysLoading ? (
              <div className="text-sm text-muted-foreground">Loading holidays...</div>
            ) : sortedHolidays.length === 0 ? (
              <div className="text-center py-8">
                <CalendarDays className="size-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No public holidays configured</p>
                <p className="text-xs text-muted-foreground mt-1">Add holidays to exclude them from working day counts</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Header */}
                <div className="hidden md:grid md:grid-cols-4 gap-4 px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
                  <span>Holiday</span>
                  <span>Date</span>
                  <span>Type</span>
                  <span className="text-right">Actions</span>
                </div>
                {sortedHolidays.map((holiday, idx) => {
                  const isPast = holiday.date < todayStr && !holiday.is_recurring;
                  return (
                    <div key={holiday.id}>
                      {idx > 0 && <Separator />}
                      <div className={`grid grid-cols-2 gap-2 px-3 py-2.5 md:grid-cols-4 md:gap-4 md:items-center ${isPast ? 'opacity-50' : ''}`}>
                        <div className="font-medium text-sm text-foreground">
                          {holiday.name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatDate(holiday.date)}
                        </div>
                        <div>
                          {holiday.is_recurring ? (
                            <Badge variant="secondary" className="text-[10px]">
                              <Repeat className="size-2.5 mr-1" />
                              Yearly
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              One-time
                            </Badge>
                          )}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(holiday)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Holiday Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Public Holiday</DialogTitle>
            <DialogDescription>
              Add a public holiday. It will be excluded from working day counts when employees apply for leave.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="holiday-name">Holiday Name</Label>
              <Input
                id="holiday-name"
                placeholder="e.g. Independence Day"
                value={holidayName}
                onChange={(e) => setHolidayName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="holiday-date">Date</Label>
              <Input
                id="holiday-date"
                type="date"
                value={holidayDate}
                onChange={(e) => setHolidayDate(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={holidayRecurring}
                onCheckedChange={setHolidayRecurring}
                id="holiday-recurring"
              />
              <Label htmlFor="holiday-recurring" className="cursor-pointer">
                Repeats every year (e.g. national holidays)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              onClick={handleAddHoliday}
              disabled={!holidayName.trim() || !holidayDate || addHolidayMutation.isPending}
            >
              {addHolidayMutation.isPending && <Loader2 className="animate-spin mr-2 size-4" />}
              Add Holiday
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Holiday Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Public Holiday</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove &ldquo;{deleteTarget?.name}&rdquo; ({formatDate(deleteTarget?.date)})?
              This will affect future leave day calculations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteHolidayMutation.mutate(deleteTarget.id)}
              disabled={deleteHolidayMutation.isPending}
            >
              {deleteHolidayMutation.isPending && <Loader2 className="animate-spin mr-2 size-4" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
