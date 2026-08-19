'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronsUpDown, Loader2, Pencil, X } from 'lucide-react';

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
import { useCreateManualEntry, useUpdateManualEntry } from '@/hooks/time-entries/use-manual-entry';
import {
  combineDateTime,
  toManualEntryPayload,
  type ManualTimeEntryFormData,
} from '@/lib/validations/time-entry';

interface TaskOption {
  id: string;
  name: string;
}

export interface TimeEntryForDialog {
  id: string;
  started_at: string;
  ended_at: string | null;
  notes?: string | null;
  type?: 'tracked' | 'manual' | 'idle';
  project?: { id: string; name: string } | null;
  task?: { id: string; title: string; name?: string } | null;
  user?: { id: string; name: string; email: string } | null;
}

type DialogMode = 'create' | 'view' | 'edit';

interface ManualTimeEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canLogOnBehalf?: boolean;
  entry?: TimeEntryForDialog | null;
  initialMode?: 'create' | 'view';
}

const TIME_RE = /^\d{2}:\d{2}$/;

export function ManualTimeEntryDialog({
  open,
  onOpenChange,
  canLogOnBehalf = false,
  entry = null,
  initialMode = 'create',
}: ManualTimeEntryDialogProps) {
  const createMutation = useCreateManualEntry();
  const updateMutation = useUpdateManualEntry();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const [taskOpen, setTaskOpen] = useState(false);
  const [mode, setMode] = useState<DialogMode>(initialMode);

  const isViewMode = mode === 'view';
  const isCreateMode = mode === 'create';

  const today = format(new Date(), 'yyyy-MM-dd');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<ManualTimeEntryFormData>({
    defaultValues: {
      user_id: null,
      project_id: '',
      task_id: null,
      date: today,
      start_time: '',
      end_time: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;

    if (entry && initialMode === 'view') {
      setMode('view');
      const started = new Date(entry.started_at);
      const ended = entry.ended_at ? new Date(entry.ended_at) : null;
      reset({
        user_id: entry.user?.id ?? null,
        project_id: entry.project?.id ?? '',
        task_id: entry.task?.id ?? null,
        date: format(started, 'yyyy-MM-dd'),
        start_time: format(started, 'HH:mm'),
        end_time: ended ? format(ended, 'HH:mm') : '',
        notes: entry.notes ?? '',
      });
    } else {
      setMode('create');
      reset({
        user_id: null,
        project_id: '',
        task_id: null,
        date: today,
        start_time: '',
        end_time: '',
        notes: '',
      });
    }
  }, [open, entry, initialMode, reset, today]);

  const projectId = watch('project_id');
  const taskId = watch('task_id');
  const dateValue = watch('date');
  const userId = watch('user_id');

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

  const validate = (data: ManualTimeEntryFormData): boolean => {
    let valid = true;
    clearErrors();

    if (!data.project_id) {
      setError('project_id', { message: 'Please select a project' });
      valid = false;
    }
    if (!data.date) {
      setError('date', { message: 'Date is required' });
      valid = false;
    }
    if (!data.start_time || !TIME_RE.test(data.start_time)) {
      setError('start_time', { message: 'Start time is required' });
      valid = false;
    }
    if (!data.end_time || !TIME_RE.test(data.end_time)) {
      setError('end_time', { message: 'End time is required' });
      valid = false;
    }
    if (valid && data.date && data.start_time && data.end_time) {
      const start = combineDateTime(data.date, data.start_time);
      const end = combineDateTime(data.date, data.end_time);
      if (end <= start) {
        setError('end_time', { message: 'End time must be after start time' });
        valid = false;
      }
    }
    return valid;
  };

  const onSubmit = (data: ManualTimeEntryFormData) => {
    if (!validate(data)) return;

    if (mode === 'edit' && entry) {
      updateMutation.mutate(
        { id: entry.id, ...toManualEntryPayload(data) },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createMutation.mutate(toManualEntryPayload(data), {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  const dialogTitle = isCreateMode
    ? 'Log Time Manually'
    : mode === 'view'
      ? 'Time Entry Details'
      : 'Edit Time Entry';

  const dialogDescription = isCreateMode
    ? "Add a time entry for work that wasn’t tracked automatically."
    : mode === 'view'
      ? 'View the details of this time entry.'
      : 'Update the details of this time entry.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>{dialogTitle}</DialogTitle>
              {isViewMode && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setMode('edit')}
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </div>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* On-behalf (managers only) */}
            {canLogOnBehalf && (
              <div className="flex flex-col gap-1.5">
                <Label>Team member</Label>
                {isViewMode ? (
                  <Input
                    value={entry?.user?.name ?? 'Myself'}
                    disabled
                    className="disabled:opacity-70"
                  />
                ) : (
                  <>
                    <UserCombobox
                      value={userId ?? null}
                      onChange={(v) => setValue('user_id', v, { shouldValidate: true })}
                      placeholder="Myself"
                      enabled={open}
                    />
                    {isCreateMode && (
                      <p className="text-xs text-muted-foreground">
                        Leave empty to log time for yourself.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Project */}
            <div className="flex flex-col gap-1.5">
              <Label>
                Project <span className="text-destructive">*</span>
              </Label>
              {isViewMode ? (
                <Input
                  value={entry?.project?.name ?? 'No project'}
                  disabled
                  className="disabled:opacity-70"
                />
              ) : (
                <>
                  <ProjectCombobox
                    value={projectId || null}
                    onChange={(v) => {
                      setValue('project_id', v ?? '', { shouldValidate: true });
                      setValue('task_id', null);
                      if (v) clearErrors('project_id');
                    }}
                    placeholder="Select a project"
                  />
                  {errors.project_id && (
                    <p className="text-xs text-destructive">{errors.project_id.message}</p>
                  )}
                </>
              )}
            </div>

            {/* Task (depends on project) */}
            <div className="flex flex-col gap-1.5">
              <Label>Task</Label>
              {isViewMode ? (
                <Input
                  value={entry?.task?.title ?? entry?.task?.name ?? 'No task'}
                  disabled
                  className="disabled:opacity-70"
                />
              ) : (
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
              )}
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1.5">
              <Label>
                Date <span className="text-destructive">*</span>
              </Label>
              {isViewMode ? (
                <Input
                  value={dateValue ? format(new Date(dateValue + 'T00:00:00'), 'MMM d, yyyy') : ''}
                  disabled
                  className="disabled:opacity-70"
                />
              ) : (
                <>
                  <DatePicker
                    value={dateValue}
                    onChange={(v) => {
                      setValue('date', v, { shouldValidate: true });
                      if (v) clearErrors('date');
                    }}
                    className="w-full"
                  />
                  {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
                </>
              )}
            </div>

            {/* Start / End time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start_time">
                  Start time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="start_time"
                  type="time"
                  disabled={isViewMode}
                  className={isViewMode ? 'disabled:opacity-70' : ''}
                  {...register('start_time')}
                  aria-invalid={!!errors.start_time}
                />
                {errors.start_time && (
                  <p className="text-xs text-destructive">{errors.start_time.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="end_time">
                  End time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="end_time"
                  type="time"
                  disabled={isViewMode}
                  className={isViewMode ? 'disabled:opacity-70' : ''}
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
                placeholder={isViewMode ? '' : 'What did you work on?'}
                disabled={isViewMode}
                className={isViewMode ? 'disabled:opacity-70' : ''}
                {...register('notes')}
                aria-invalid={!!errors.notes}
              />
              {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
            </div>
          </div>

          <DialogFooter>
            {isViewMode ? (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (mode === 'edit') {
                      setMode('view');
                    } else {
                      onOpenChange(false);
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                  {mode === 'edit' ? 'Save Changes' : 'Submit'}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
