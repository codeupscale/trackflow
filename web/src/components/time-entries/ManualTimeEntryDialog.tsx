'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronsUpDown, Loader2, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProjectCombobox } from '@/components/time-entries/ProjectCombobox';
import { UserCombobox } from '@/components/time-entries/UserCombobox';
import { useCreateManualEntry } from '@/hooks/time-entries/use-manual-entry';
import {
  manualTimeEntrySchema,
  toManualEntryPayload,
  type ManualTimeEntryFormData,
} from '@/lib/validations/time-entry';

interface TaskOption {
  id: string;
  name: string;
}

interface ManualTimeEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Managers with `time_entries.approve` may log time on behalf of a team member. */
  canLogOnBehalf?: boolean;
}

export function ManualTimeEntryDialog({
  open,
  onOpenChange,
  canLogOnBehalf = false,
}: ManualTimeEntryDialogProps) {
  const { mutate, isPending } = useCreateManualEntry();
  const [taskOpen, setTaskOpen] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ManualTimeEntryFormData>({
    // zodResolver's inferred generic doesn't line up with RHF here (optional/refine);
    // the codebase casts this the same way in other forms.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(manualTimeEntrySchema) as any,
    defaultValues: {
      user_id: null,
      project_id: null,
      task_id: null,
      date: today,
      start_time: '09:00',
      end_time: '17:00',
      notes: '',
    },
  });

  // Reset to a clean form each time the dialog opens.
  useEffect(() => {
    if (open) {
      reset({
        user_id: null,
        project_id: null,
        task_id: null,
        date: today,
        start_time: '09:00',
        end_time: '17:00',
        notes: '',
      });
    }
    // `today` is stable within a render pass; reset only when `open` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  const projectId = watch('project_id');
  const taskId = watch('task_id');
  const dateValue = watch('date');
  const userId = watch('user_id');

  // Tasks depend on the chosen project. Clear the task whenever the project changes.
  const { data: tasks, isLoading: tasksLoading } = useQuery<TaskOption[]>({
    queryKey: ['tasks-list', projectId],
    queryFn: async () => {
      const res = await api.get('/tasks', { params: { project_id: projectId, per_page: 50 } });
      return res.data.data ?? res.data.tasks ?? (Array.isArray(res.data) ? res.data : []);
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const selectedTask = tasks?.find((t) => t.id === taskId) ?? null;

  const onSubmit = (data: ManualTimeEntryFormData) => {
    mutate(toManualEntryPayload(data), {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Log Time Manually</DialogTitle>
            <DialogDescription>
              Add a time entry for work that wasn&apos;t tracked automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* On-behalf (managers only) */}
            {canLogOnBehalf && (
              <div className="flex flex-col gap-1.5">
                <Label>Team member</Label>
                <UserCombobox
                  value={userId ?? null}
                  onChange={(v) => setValue('user_id', v, { shouldValidate: true })}
                  placeholder="Myself"
                  enabled={open}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to log time for yourself.
                </p>
              </div>
            )}

            {/* Project */}
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <ProjectCombobox
                value={projectId ?? null}
                onChange={(v) => {
                  setValue('project_id', v, { shouldValidate: true });
                  setValue('task_id', null);
                }}
                placeholder="No project"
              />
              {errors.project_id && (
                <p className="text-xs text-destructive">{errors.project_id.message}</p>
              )}
            </div>

            {/* Task (depends on project) */}
            <div className="flex flex-col gap-1.5">
              <Label>Task</Label>
              <Popover open={taskOpen} onOpenChange={setTaskOpen}>
                <PopoverTrigger
                  disabled={!projectId}
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={taskOpen}
                      aria-label="Select task"
                      className={cn(
                        'w-full justify-between font-normal',
                        !taskId && 'text-muted-foreground'
                      )}
                    />
                  }
                >
                  <span className="truncate">
                    {selectedTask ? selectedTask.name : projectId ? 'No task' : 'Select a project first'}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {taskId && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="rounded-sm opacity-70 hover:opacity-100"
                        aria-label="Clear task"
                        onClick={(e) => {
                          e.stopPropagation();
                          setValue('task_id', null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            setValue('task_id', null);
                          }
                        }}
                      >
                        <X className="size-3.5" />
                      </span>
                    )}
                    <ChevronsUpDown className="size-3.5 opacity-50" />
                  </div>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--anchor-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search tasks..." />
                    <CommandList>
                      <CommandEmpty>{tasksLoading ? 'Loading...' : 'No tasks found.'}</CommandEmpty>
                      <CommandGroup>
                        {tasks?.map((t) => (
                          <CommandItem
                            key={t.id}
                            value={t.name}
                            data-checked={taskId === t.id ? 'true' : undefined}
                            onSelect={() => {
                              setValue('task_id', t.id === taskId ? null : t.id, {
                                shouldValidate: true,
                              });
                              setTaskOpen(false);
                            }}
                          >
                            <span className="truncate">{t.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <DatePicker
                value={dateValue}
                onChange={(v) => setValue('date', v, { shouldValidate: true })}
                className="w-full"
              />
              {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
            </div>

            {/* Start / End time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start_time">Start time</Label>
                <Input
                  id="start_time"
                  type="time"
                  {...register('start_time')}
                  aria-invalid={!!errors.start_time}
                />
                {errors.start_time && (
                  <p className="text-xs text-destructive">{errors.start_time.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="end_time">End time</Label>
                <Input
                  id="end_time"
                  type="time"
                  {...register('end_time')}
                  aria-invalid={!!errors.end_time}
                />
                {errors.end_time && (
                  <p className="text-xs text-destructive">{errors.end_time.message}</p>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="What did you work on?"
                {...register('notes')}
                aria-invalid={!!errors.notes}
              />
              {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
