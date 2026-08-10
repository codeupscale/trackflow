'use client';

import { Eye, EyeOff, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  employmentTypeLabels,
  workModeLabels,
  formatSalaryDisplay,
  withCurrency,
  isFuturePostingDate,
  formatPostingDate,
  type JobPosting,
} from '@/lib/validations/job-posting';

interface JobPostingViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posting: JobPosting | null;
  /** Omitted when the viewer lacks job_postings.edit. */
  onEdit?: (posting: JobPosting) => void;
  /** Omitted when the viewer lacks job_postings.publish. Toggles the state. */
  onTogglePublished?: (posting: JobPosting) => void;
}

/** "09:00:00" -> "9:00 AM" */
function to12Hour(value: string): string {
  const [rawHours, minutes] = value.split(':');
  const hours = Number(rawHours);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${suffix}`;
}

function workingHours(posting: JobPosting): string {
  if (!posting.start_time || !posting.end_time) return '--';
  return `${to12Hour(posting.start_time)} - ${to12Hour(posting.end_time)}`;
}

function salary(posting: JobPosting): string {
  if (!posting.send_salary_via_api) return 'Not published';
  const display =
    posting.salary_display ??
    formatSalaryDisplay(posting.min_salary, posting.max_salary);
  return withCurrency(display) ?? '--';
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export function JobPostingViewDialog({
  open,
  onOpenChange,
  posting,
  onEdit,
  onTogglePublished,
}: JobPostingViewDialogProps) {
  if (!posting) return null;

  const scheduled = isFuturePostingDate(posting.posting_date);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden p-6">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <DialogTitle>{posting.title}</DialogTitle>
            <Badge variant={posting.is_published ? 'default' : 'secondary'}>
              {posting.is_published ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <DialogDescription>
            {posting.department?.name ?? 'No department'}
            {posting.position?.title ? ` · ${posting.position.title}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field
              label="Employment Type"
              value={employmentTypeLabels[posting.employment_type]}
            />
            <Field label="Work Mode" value={workModeLabels[posting.work_mode]} />
            <Field label="Location" value={posting.location ?? '--'} />
            <Field label="Working Hours" value={workingHours(posting)} />
            <Field label="Posting Date" value={posting.posting_date ?? '--'} />
            <Field label="Salary" value={salary(posting)} />
          </div>

          {posting.short_description && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Short Description
              </span>
              <p className="text-sm">{posting.short_description}</p>
            </div>
          )}

          {posting.long_description ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Full Description
              </span>
              {/*
                Safe by construction: long_description is sanitised against an
                allow-list by JobDescriptionSanitizer before it is ever stored,
                so the column cannot hold script, event handlers or javascript:
                URLs. This is the same contract the careers page relies on.
              */}
              <div
                className="prose prose-sm dark:prose-invert max-w-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul,&_ol]:pl-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_a]:underline [&_a]:underline-offset-2"
                dangerouslySetInnerHTML={{ __html: posting.long_description }}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No full description has been written for this posting yet.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:items-start sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          <div className="flex flex-col gap-1.5 sm:items-end">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {onEdit && (
                <Button
                  variant="outline"
                  // Note this does NOT close the view. The page keeps the
                  // viewed posting in state and stacks the edit form over it,
                  // so saving (or cancelling) drops back here rather than
                  // dumping the user on the list.
                  onClick={() => onEdit(posting)}
                >
                  <Pencil data-icon="inline-start" />
                  Edit
                </Button>
              )}
              {onTogglePublished && (
                <Button
                  // Same rule as the row menu: a future-dated posting is
                  // filtered out of the careers feed, so publishing it would
                  // only produce a badge that lies. Unpublishing is never
                  // blocked.
                  disabled={!posting.is_published && scheduled}
                  variant={posting.is_published ? 'outline' : 'default'}
                  onClick={() => onTogglePublished(posting)}
                >
                  {posting.is_published ? (
                    <>
                      <EyeOff data-icon="inline-start" />
                      Unpublish
                    </>
                  ) : (
                    <>
                      <Eye data-icon="inline-start" />
                      Publish
                    </>
                  )}
                </Button>
              )}
            </div>

            {onTogglePublished && !posting.is_published && scheduled && (
              // Without this the button is greyed out with no clue why.
              <p className="text-xs text-muted-foreground sm:text-right">
                Dated {formatPostingDate(posting.posting_date!)}. Change the
                posting date to publish.
              </p>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
