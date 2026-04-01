'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
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
  const [selectedUsers, setSelectedUsers] = useState<
    { id: string; name: string }[]
  >([]);
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().split('T')[0]
  );
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
      setSelectedUsers((prev) => [...prev, { id: emp.id, name: emp.name }]);
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
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Assign Users</DialogTitle>
          <DialogDescription>
            Select multiple users to assign to this shift.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label>Add Employee</Label>
            <Select
              onValueChange={(val: string | null) => { if (val) handleAddUser(val); }}
              disabled={loadingEmployees}
            >
              <SelectTrigger className="mt-1.5" aria-label="Select employee">
                <SelectValue
                  placeholder={
                    loadingEmployees ? 'Loading...' : 'Select employee to add'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <div className="p-2">
                  <Input
                    placeholder="Search employees..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="mb-2"
                  />
                </div>
                <SelectGroup>
                  {employees
                    .filter(
                      (emp) => !selectedUsers.some((u) => u.id === emp.id)
                    )
                    .map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name} ({emp.email})
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {selectedUsers.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">
                Selected ({selectedUsers.length})
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {selectedUsers.map((user) => (
                  <Badge
                    key={user.id}
                    variant="secondary"
                    className="gap-1 pr-1"
                  >
                    {user.name}
                    <button
                      type="button"
                      onClick={() => handleRemoveUser(user.id)}
                      className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label={`Remove ${user.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="bulk-from">Effective From</Label>
              <Input
                id="bulk-from"
                type="date"
                className="mt-1.5"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="bulk-to">Effective To (optional)</Label>
              <Input
                id="bulk-to"
                type="date"
                className="mt-1.5"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={bulkAssignMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              bulkAssignMutation.isPending || selectedUsers.length === 0
            }
          >
            {bulkAssignMutation.isPending && (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            )}
            Assign {selectedUsers.length} User
            {selectedUsers.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
