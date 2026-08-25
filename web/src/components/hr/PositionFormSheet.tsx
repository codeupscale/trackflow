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
import { Switch } from '@/components/ui/switch';
import { useCodeFromName, abbreviateCode } from '@/hooks/use-code-from-name';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  positionSchema,
  positionLevels,
  employmentTypes,
  positionLevelLabels,
  employmentTypeLabels,
  type PositionInput,
  type Position,
} from '@/lib/validations/position';
import {
  useCreatePosition,
  useUpdatePosition,
} from '@/hooks/hr/use-positions';

interface PositionFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position?: Position | null;
}

export function PositionFormSheet({
  open,
  onOpenChange,
  position,
}: PositionFormSheetProps) {
  const isEditing = !!position;

  const form = useForm<PositionInput>({
    resolver: zodResolver(positionSchema) as any,
    defaultValues: {
      title: '',
      code: '',
      department_id: '' as PositionInput['department_id'],
      level: 'mid',
      employment_type: 'full_time',
      is_active: true,
    },
  });

  // Positions read from `title`, not `name` (Senior Engineer -> SSE). The
  // numeric suffix in the "SSE-001" placeholder is a sequence the client
  // cannot know, so only the letter part is suggested — the user appends it.
  useCodeFromName({
    form,
    sourceField: 'title',
    codeField: 'code',
    generate: abbreviateCode,
    enabled: !isEditing,
  });

  useEffect(() => {
    if (!open) return;
    if (position) {
      form.reset({
        title: position.title,
        code: position.code,
        department_id: position.department_id,
        level: position.level,
        employment_type: position.employment_type,
        is_active: position.is_active,
      });
    } else {
      form.reset({
        title: '',
        code: '',
        department_id: '' as PositionInput['department_id'],
        level: 'mid',
        employment_type: 'full_time',
        is_active: true,
      });
    }
  }, [open, position, form]);

  const createMutation = useCreatePosition();
  const updateMutation = useUpdatePosition();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: PositionInput) => {
    if (isEditing && position) {
      updateMutation.mutate(
        { id: position.id, ...data },
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
            {isEditing ? 'Edit Position' : 'New Position'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the position details below.'
              : 'Create a new position within a department.'}
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
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Senior Engineer"
                        className="h-8 text-sm"
                        {...field}
                      />
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
                      <Input
                        placeholder="e.g. SSE-001"
                        className="h-8 text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="department_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Department</FormLabel>
                  <FormControl>
                    <DepartmentSelect
                      value={field.value || null}
                      onChange={(val) => field.onChange(val ?? '')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Level</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="h-8 w-full text-sm">
                          <SelectValue placeholder="Select level" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {positionLevels.map((level) => (
                            <SelectItem key={level} value={level}>
                              {positionLevelLabels[level]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="employment_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Employment Type</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="h-8 w-full text-sm">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {employmentTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {employmentTypeLabels[type]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <FormLabel className="text-xs">Active</FormLabel>
                    <p className="text-[0.65rem] text-muted-foreground">
                      Inactive positions are hidden from assignment
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
                {isEditing ? 'Save Changes' : 'Create Position'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
