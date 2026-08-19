'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, Loader2, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  shiftAssignmentSchema,
  type ShiftAssignmentFormData,
} from '@/lib/validations/shift';
import { useAssignShift } from '@/hooks/hr/use-shift-assignments';
import { useEmployees } from '@/hooks/hr/use-employees';

const avatarColors = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

interface ShiftAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
}

export function ShiftAssignmentDialog({
  open,
  onOpenChange,
  shiftId,
}: ShiftAssignmentDialogProps) {
  const [search, setSearch] = useState('');
  const { data: employeesData, isLoading: loadingEmployees } = useEmployees({
    search: search || undefined,
    per_page: 50,
  });
  const employees = employeesData?.data ?? [];

  const assignMutation = useAssignShift();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ShiftAssignmentFormData>({
    resolver: zodResolver(shiftAssignmentSchema) as any,
    defaultValues: {
      user_id: '',
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: null,
    },
  });

  const userIdValue = watch('user_id');
  const selectedEmployee = userIdValue ? employees.find((e) => e.id === userIdValue) : null;

  const onSubmit = (data: ShiftAssignmentFormData) => {
    assignMutation.mutate(
      { shiftId, ...data },
      {
        onSuccess: () => {
          onOpenChange(false);
          reset();
          setSearch('');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <UserPlus className="h-3.5 w-3.5 text-primary" />
              </div>
              Assign User
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select an employee and set the effective date range for this shift assignment.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            {/* Employee selector */}
            <div className="grid gap-1.5">
              <Label className="text-xs">Employee</Label>
              <Select
                value={userIdValue}
                onValueChange={(val) => { if (val) setValue('user_id', val, { shouldValidate: true }); }}
                disabled={loadingEmployees}
              >
                <SelectTrigger className="h-9 text-sm" aria-label="Select employee">
                  {selectedEmployee ? (
                    <span className="flex items-center gap-2 truncate">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className={`${getAvatarColor(selectedEmployee.name)} text-white text-[7px] font-medium`}>
                          {getInitials(selectedEmployee.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">{selectedEmployee.name}</span>
                    </span>
                  ) : (
                    <SelectValue placeholder={loadingEmployees ? 'Loading...' : 'Select employee'} />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Search employees..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 text-xs mb-2"
                    />
                  </div>
                  <SelectGroup>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        <span className="flex items-center gap-2">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className={`${getAvatarColor(emp.name)} text-white text-[7px] font-medium`}>
                              {getInitials(emp.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="flex flex-col">
                            <span className="text-[0.75rem] font-medium">{emp.name}</span>
                            <span className="text-[0.6rem] text-muted-foreground">{emp.email}</span>
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {errors.user_id && <p className="text-[0.65rem] text-destructive">{errors.user_id.message}</p>}
            </div>

            {/* Date range */}
            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Date Range</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="assign-from" className="text-[0.65rem] text-muted-foreground">From</Label>
                  <Input
                    id="assign-from"
                    type="date"
                    className="h-8 text-xs"
                    {...register('effective_from')}
                    aria-invalid={!!errors.effective_from}
                  />
                  {errors.effective_from && <p className="text-[0.6rem] text-destructive">{errors.effective_from.message}</p>}
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="assign-to" className="text-[0.65rem] text-muted-foreground">To (optional)</Label>
                  <Input
                    id="assign-to"
                    type="date"
                    className="h-8 text-xs"
                    value={watch('effective_to') ?? ''}
                    onChange={(e) => setValue('effective_to', e.target.value || null)}
                    aria-invalid={!!errors.effective_to}
                  />
                  {errors.effective_to && <p className="text-[0.6rem] text-destructive">{errors.effective_to.message}</p>}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onOpenChange(false)}
              disabled={assignMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs" disabled={assignMutation.isPending || !userIdValue}>
              {assignMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Assign User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
