'use client';

import { useState } from 'react';
import { CalendarDays, Loader2, Users, X } from 'lucide-react';
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
import { useBulkAssignShift } from '@/hooks/hr/use-shift-assignments';
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

interface ShiftBulkAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
}

export function ShiftBulkAssignDialog({
  open,
  onOpenChange,
  shiftId,
}: ShiftBulkAssignDialogProps) {
  const [search, setSearch] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [effectiveTo, setEffectiveTo] = useState('');

  const { data: employeesData, isLoading: loadingEmployees } = useEmployees({
    search: search || undefined,
    per_page: 50,
  });
  const employees = employeesData?.data ?? [];

  const bulkAssignMutation = useBulkAssignShift();

  const handleAddUser = (userId: string) => {
    const emp = employees.find((e) => e.id === userId);
    if (emp && !selectedUsers.some((u) => u.id === userId)) {
      setSelectedUsers((prev) => [...prev, { id: emp.id, name: emp.name, email: emp.email }]);
    }
  };

  const handleRemoveUser = (userId: string) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const handleSubmit = () => {
    if (selectedUsers.length === 0 || !effectiveFrom) return;
    bulkAssignMutation.mutate(
      {
        shiftId,
        user_ids: selectedUsers.map((u) => u.id),
        effective_from: effectiveFrom,
        effective_to: effectiveTo || null,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setSelectedUsers([]);
          setSearch('');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-3.5 w-3.5 text-primary" />
            </div>
            Bulk Assign
          </DialogTitle>
          <DialogDescription className="text-xs">
            Select multiple employees to assign to this shift at once.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* Employee selector */}
          <div className="grid gap-1.5">
            <Label className="text-xs">Add Employee</Label>
            <Select
              onValueChange={(val: string | null) => { if (val) handleAddUser(val); }}
              disabled={loadingEmployees}
            >
              <SelectTrigger className="h-9 text-sm" aria-label="Select employee to add">
                <SelectValue placeholder={loadingEmployees ? 'Loading...' : 'Search and add employees'} />
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
                  {employees
                    .filter((emp) => !selectedUsers.some((u) => u.id === emp.id))
                    .map((emp) => (
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
          </div>

          {/* Selected users list */}
          {selectedUsers.length > 0 && (
            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
                  Selected ({selectedUsers.length})
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedUsers([])}
                  className="text-[0.6rem] text-muted-foreground hover:text-destructive transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {selectedUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-5 w-5 shrink-0">
                        <AvatarFallback className={`${getAvatarColor(user.name)} text-white text-[7px] font-medium`}>
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-[0.7rem] font-medium truncate">{user.name}</p>
                        <p className="text-[0.55rem] text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveUser(user.id)}
                      className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={`Remove ${user.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Date range */}
          <div className="rounded-lg border border-border/60 p-3">
            <div className="flex items-center gap-1.5 mb-2.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Date Range</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="bulk-from" className="text-[0.65rem] text-muted-foreground">From</Label>
                <Input
                  id="bulk-from"
                  type="date"
                  className="h-8 text-xs"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="bulk-to" className="text-[0.65rem] text-muted-foreground">To (optional)</Label>
                <Input
                  id="bulk-to"
                  type="date"
                  className="h-8 text-xs"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                />
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
            disabled={bulkAssignMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            onClick={handleSubmit}
            disabled={bulkAssignMutation.isPending || selectedUsers.length === 0}
          >
            {bulkAssignMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Assign {selectedUsers.length} User{selectedUsers.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
