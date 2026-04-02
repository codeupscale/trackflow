'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
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
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
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

  const form = useForm<ShiftAssignmentFormData>({
    resolver: zodResolver(shiftAssignmentSchema) as any,
    defaultValues: {
      user_id: '',
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: null,
    },
  });

  const onSubmit = (data: ShiftAssignmentFormData) => {
    assignMutation.mutate(
      {
        shiftId,
        ...data,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          form.reset();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign User to Shift</DialogTitle>
          <DialogDescription>
            Select a user and set the effective date range.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <FormField
              control={form.control}
              name="user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={loadingEmployees}
                    >
                      <SelectTrigger aria-label="Select employee">
                        <SelectValue
                          placeholder={
                            loadingEmployees
                              ? 'Loading...'
                              : 'Select employee'
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
                          {employees.map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.name} ({emp.email})
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="effective_from"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Effective From</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="effective_to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Effective To (optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={assignMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={assignMutation.isPending}>
                {assignMutation.isPending && (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                )}
                Assign
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
