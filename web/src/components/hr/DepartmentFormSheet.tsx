'use client';

import { useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { DepartmentSelect } from '@/components/hr/DepartmentSelect';
import {
  departmentSchema,
  type DepartmentInput,
  type Department,
} from '@/lib/validations/department';
import {
  useCreateDepartment,
  useUpdateDepartment,
} from '@/hooks/hr/use-departments';

interface DepartmentFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department?: Department | null;
}

export function DepartmentFormSheet({
  open,
  onOpenChange,
  department,
}: DepartmentFormSheetProps) {
  const isEditing = !!department;

  const form = useForm<DepartmentInput>({
    resolver: zodResolver(departmentSchema) as any,
    defaultValues: {
      name: '',
      code: '',
      description: '',
      parent_department_id: null,
      manager_id: null,
      is_active: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (department) {
      form.reset({
        name: department.name,
        code: department.code,
        description: department.description ?? '',
        parent_department_id: department.parent_department_id ?? null,
        manager_id: department.manager_id ?? null,
        is_active: department.is_active,
      });
    } else {
      form.reset({
        name: '',
        code: '',
        description: '',
        parent_department_id: null,
        manager_id: null,
        is_active: true,
      });
    }
  }, [open, department, form]);

  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: DepartmentInput) => {
    if (isEditing && department) {
      updateMutation.mutate(
        { id: department.id, ...data },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      createMutation.mutate(data, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Department' : 'New Department'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the department details below.'
              : 'Create a new department for your organization.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Engineering" className="h-8 text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Code</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. ENG" className="h-8 text-sm" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional description..."
                      rows={2}
                      className="text-sm resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="parent_department_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Parent Department</FormLabel>
                  <FormControl>
                    <DepartmentSelect
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="None (top-level)"
                      excludeId={department?.id}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <FormLabel className="text-xs">Active</FormLabel>
                    <p className="text-[0.65rem] text-muted-foreground">
                      Inactive departments are hidden from selection
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                {isEditing ? 'Save Changes' : 'Create Department'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
