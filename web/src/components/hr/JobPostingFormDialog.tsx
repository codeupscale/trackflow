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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Switch } from '@/components/ui/switch';
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
import { PositionSelect } from '@/components/hr/PositionSelect';
import {
  jobPostingSchema,
  employmentTypes,
  employmentTypeLabels,
  workModes,
  workModeLabels,
  SALARY_CURRENCY,
  type JobPostingInput,
  type JobPosting,
} from '@/lib/validations/job-posting';
import {
  useCreateJobPosting,
  useUpdateJobPosting,
} from '@/hooks/hr/use-job-postings';

interface JobPostingFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posting?: JobPosting | null;
}

const EMPTY: JobPostingInput = {
  title: '',
  department_id: '' as JobPostingInput['department_id'],
  position_id: null,
  employment_type: 'full_time',
  work_mode: 'on_site',
  location: '',
  posting_date: null,
  start_time: null,
  end_time: null,
  min_salary: null,
  max_salary: null,
  send_salary_via_api: false,
  short_description: '',
  long_description: '',
};

function toTimeInput(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : '';
}

function toDateInput(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function JobPostingFormDialog({
  open,
  onOpenChange,
  posting,
}: JobPostingFormDialogProps) {
  const isEditing = !!posting;

  const form = useForm<JobPostingInput>({
    resolver: zodResolver(jobPostingSchema) as any,
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    if (posting) {
      form.reset({
        title: posting.title,
        department_id: posting.department_id,
        position_id: posting.position_id,
        employment_type: posting.employment_type,
        work_mode: posting.work_mode,
        location: posting.location ?? '',
        posting_date: toDateInput(posting.posting_date),
        start_time: toTimeInput(posting.start_time) || null,
        end_time: toTimeInput(posting.end_time) || null,
        min_salary: toNumber(posting.min_salary),
        max_salary: toNumber(posting.max_salary),
        send_salary_via_api: posting.send_salary_via_api,
        short_description: posting.short_description ?? '',
        long_description: posting.long_description ?? '',
      });
    } else {
      form.reset(EMPTY);
    }
  }, [open, posting, form]);

  const createMutation = useCreateJobPosting();
  const updateMutation = useUpdateJobPosting();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const departmentId = form.watch('department_id');
  const shortDescription = form.watch('short_description') ?? '';

  const onSubmit = (data: JobPostingInput) => {
    const payload: JobPostingInput = {
      ...data,
      location: data.location || null,
      short_description: data.short_description || null,
      long_description: data.long_description || null,
      start_time: data.start_time || null,
      end_time: data.end_time || null,
      posting_date: data.posting_date || null,
    };

    if (isEditing && posting) {
      updateMutation.mutate(
        { id: posting.id, ...payload },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] grid-rows-[auto_1fr] overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-base">
            {isEditing ? 'Edit Job Posting' : 'New Job Posting'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEditing
              ? 'Update the job posting below.'
              : 'Create a new job posting for your organization.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col min-h-0 overflow-y-auto px-5 pb-5"
          >
            <div className="flex flex-col gap-3.5 pt-4">
              {/* ── Basic Info ── */}
              <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground">Basic Information</p>

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Job Title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Senior React Developer"
                        className="h-8 text-sm"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="department_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Department</FormLabel>
                      <FormControl>
                        <DepartmentSelect
                          value={field.value || null}
                          onChange={(val) => {
                            field.onChange(val ?? '');
                            form.setValue('position_id', null);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="position_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Position</FormLabel>
                      <FormControl>
                        <PositionSelect
                          value={field.value ?? null}
                          onChange={(val) => field.onChange(val)}
                          departmentId={departmentId || undefined}
                          disabled={!departmentId}
                          placeholder={
                            departmentId
                              ? 'Select position...'
                              : 'Select department first'
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="employment_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Employment Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-8 w-full text-sm">
                            <SelectValue placeholder="Select type">
                              {(value: string | null) =>
                                value
                                  ? (employmentTypeLabels[
                                      value as keyof typeof employmentTypeLabels
                                    ] ?? value)
                                  : 'Select type'
                              }
                            </SelectValue>
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

                <FormField
                  control={form.control}
                  name="work_mode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Work Mode</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-8 w-full text-sm">
                            <SelectValue placeholder="Select mode">
                              {(value: string | null) =>
                                value
                                  ? (workModeLabels[
                                      value as keyof typeof workModeLabels
                                    ] ?? value)
                                  : 'Select mode'
                              }
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectGroup>
                            {workModes.map((mode) => (
                              <SelectItem key={mode} value={mode}>
                                {workModeLabels[mode]}
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

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Location</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Karachi, Pakistan"
                          className="h-8 text-sm"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="posting_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Posting Date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          className="h-8 text-sm"
                          {...field}
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
              </div>

              {/* ── Schedule & Compensation ── */}
              <div className="border-t border-border/50 pt-3.5 mt-1">
                <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground mb-3.5">Schedule & Compensation</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="start_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Shift Start</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          className="h-8 text-sm"
                          {...field}
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

                <FormField
                  control={form.control}
                  name="end_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Shift End</FormLabel>
                      <FormControl>
                        <Input
                          type="time"
                          className="h-8 text-sm"
                          {...field}
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="min_salary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Salary (min)</FormLabel>
                      <FormControl>
                        <InputGroup>
                          <InputGroupAddon align="inline-start">
                            <InputGroupText>{SALARY_CURRENCY}</InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput
                            type="number"
                            min="0"
                            step="any"
                            placeholder="e.g. 80000"
                            className="h-8 text-sm"
                            value={field.value ?? ''}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                          />
                        </InputGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="max_salary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Salary (max)</FormLabel>
                      <FormControl>
                        <InputGroup>
                          <InputGroupAddon align="inline-start">
                            <InputGroupText>{SALARY_CURRENCY}</InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput
                            type="number"
                            min="0"
                            step="any"
                            placeholder="e.g. 120000"
                            className="h-8 text-sm"
                            value={field.value ?? ''}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                          />
                        </InputGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="send_salary_via_api"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <FormLabel className="text-xs">Publish salary range</FormLabel>
                      <p className="text-[0.65rem] text-muted-foreground">
                        Show salary on the careers page
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

              {/* ── Description ── */}
              <div className="border-t border-border/50 pt-3.5 mt-1">
                <p className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground mb-3.5">Description</p>
              </div>

              <FormField
                control={form.control}
                name="short_description"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs">Short Description</FormLabel>
                      <span className="text-[0.6rem] text-muted-foreground tabular-nums">
                        {shortDescription.length}/500
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="One or two lines shown on the listing card."
                        className="text-sm resize-none"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="long_description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Full Description</FormLabel>
                    <FormControl>
                      <RichTextEditor
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="sticky bottom-0 mt-4 gap-2 bg-popover pt-3 -mx-0.5 px-0.5 border-t border-border/50">
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
                {isEditing ? 'Save Changes' : 'Create Job Posting'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
