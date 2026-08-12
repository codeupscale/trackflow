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

/** The API returns HH:MM:SS; <input type="time"> wants HH:MM. */
function toTimeInput(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : '';
}

/**
 * <input type="date"> only accepts YYYY-MM-DD. The server now sends exactly
 * that, but trim defensively: a date field that silently renders blank writes
 * null back on the next save and destroys the stored value.
 */
function toDateInput(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/** Accepts whatever the API sends and returns a number the schema will take. */
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

  // Keyed on `open`, not just `posting`. Going create -> close -> create leaves
  // `posting` null the whole time, so an effect watching only `posting` never
  // re-runs and the previous draft's text is still sitting in the fields.
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
        // Defensive Number(): encrypted columns decrypt to strings, and a
        // string here fails the schema with "expected number, received string".
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
  const sendSalary = form.watch('send_salary_via_api');
  const shortDescription = form.watch('short_description') ?? '';

  const onSubmit = (data: JobPostingInput) => {
    // Blank strings are "no value", not empty values — the server treats them
    // the same way, but sending null keeps the intent explicit.
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
      {/* DialogContent defaults to sm:max-w-sm and no height cap. This form is
          two columns and taller than most viewports, so it needs both a wider
          shell and an explicit max height with the body scrolling inside. */}
      <DialogContent className="sm:max-w-2xl max-h-[90vh] grid-rows-[auto_1fr] overflow-hidden p-6">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Job Posting' : 'New Job Posting'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the job posting below.'
              : 'Create a new job posting for your organization.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col min-h-0 gap-6 overflow-y-auto pr-1"
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Senior React Developer"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="department_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <DepartmentSelect
                        value={field.value || null}
                        onChange={(val) => {
                          field.onChange(val ?? '');
                          // A position belongs to one department, so a changed
                          // department invalidates the current selection.
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
                    <FormLabel>Position</FormLabel>
                    <FormControl>
                      <PositionSelect
                        value={field.value ?? null}
                        onChange={(val) => field.onChange(val)}
                        departmentId={departmentId || undefined}
                        disabled={!departmentId}
                        placeholder={
                          departmentId
                            ? 'Select position...'
                            : 'Select a department first'
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="employment_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employment Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          {/* Base UI renders the raw value without a formatter,
                              which would show "full_time" instead of "Full Time". */}
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
                    <FormLabel>Work Mode</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Karachi, Pakistan"
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
                    <FormLabel>Posting Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value || null)
                        }
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Cannot publish before this date.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="start_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shift Start Time</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
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
                    <FormLabel>Shift End Time</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="min_salary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Salary (min)</FormLabel>
                    <FormControl>
                      {/* PKR is fixed: the product is single-currency, so it is
                          an adornment here rather than a stored field. */}
                      <InputGroup>
                        <InputGroupAddon align="inline-start">
                          <InputGroupText>{SALARY_CURRENCY}</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          type="number"
                          // min=0 blocks negatives natively; Zod rejects 0 with
                          // a clearer message. Not step="1000" — browsers only
                          // accept min + n*step, which would reject ordinary
                          // figures like 87500.
                          min="0"
                          step="any"
                          placeholder="e.g. 80000"
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
                    <FormLabel>Salary (max)</FormLabel>
                    <FormControl>
                      {/* PKR is fixed: the product is single-currency, so it is
                          an adornment here rather than a stored field. */}
                      <InputGroup>
                        <InputGroupAddon align="inline-start">
                          <InputGroupText>{SALARY_CURRENCY}</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          type="number"
                          // min=0 blocks negatives natively; Zod rejects 0 with
                          // a clearer message. Not step="1000" — browsers only
                          // accept min + n*step, which would reject ordinary
                          // figures like 87500.
                          min="0"
                          step="any"
                          placeholder="e.g. 120000"
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
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <FormLabel>Send salary range via API</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Used when job postings are published to the company
                      website.
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

            {sendSalary && (
              <p className="-mt-4 text-xs text-muted-foreground">
                Enter both for a range, only a minimum for &ldquo;From
                X&rdquo;, or only a maximum for &ldquo;Up to Y&rdquo;.
              </p>
            )}

            <FormField
              control={form.control}
              name="short_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Short Description</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="One or two lines shown on the listing card."
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Up to 500 characters. {shortDescription.length}/500
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="long_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Description</FormLabel>
                  <FormControl>
                    <RichTextEditor
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      disabled={isPending}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Shown on the careers page. Formatting is limited to what the
                    toolbar offers — anything else is removed when saved.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* sticky so the actions stay reachable while the body scrolls */}
            <DialogFooter className="sticky bottom-0 -mx-1 mt-auto gap-2 bg-popover pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
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
