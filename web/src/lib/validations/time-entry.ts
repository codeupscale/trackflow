import { z } from 'zod/v4';

// ─── Manual time entry form ───────────────────────────────────────────
//
// The form collects a calendar date plus wall-clock start/end times and an
// optional project/task/notes. On submit the caller combines date + time into
// ISO `started_at`/`ended_at` strings (see `toManualEntryPayload`). On-behalf
// submission (`user_id`) is only surfaced to managers who hold
// `time_entries.approve` — employees never see the field.

const TIME_RE = /^\d{2}:\d{2}$/;

export const manualTimeEntrySchema = z
  .object({
    user_id: z.string().uuid('Please select a valid team member').optional().nullable(),
    project_id: z.string().uuid('Please select a valid project').optional().nullable(),
    task_id: z.string().uuid('Please select a valid task').optional().nullable(),
    date: z.string().min(1, 'Date is required'),
    start_time: z.string().regex(TIME_RE, 'Enter a valid start time'),
    end_time: z.string().regex(TIME_RE, 'Enter a valid end time'),
    notes: z.string().max(1000, 'Notes must be 1000 characters or less').optional(),
  })
  .refine((d) => combineDateTime(d.date, d.end_time) > combineDateTime(d.date, d.start_time), {
    message: 'End time must be after the start time',
    path: ['end_time'],
  })
  .refine((d) => combineDateTime(d.date, d.start_time).getTime() <= Date.now(), {
    message: 'Time entries cannot start in the future',
    path: ['start_time'],
  });

export type ManualTimeEntryFormData = z.infer<typeof manualTimeEntrySchema>;

/** Combine a `YYYY-MM-DD` date and `HH:mm` time into a local Date. */
export function combineDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

/** API payload for `POST /time-entries`. */
export interface ManualTimeEntryPayload {
  user_id?: string;
  project_id?: string;
  task_id?: string;
  started_at: string;
  ended_at: string;
  notes?: string;
}

/** Convert validated form data into the API payload (ISO timestamps). */
export function toManualEntryPayload(data: ManualTimeEntryFormData): ManualTimeEntryPayload {
  return {
    user_id: data.user_id ?? undefined,
    project_id: data.project_id ?? undefined,
    task_id: data.task_id ?? undefined,
    started_at: combineDateTime(data.date, data.start_time).toISOString(),
    ended_at: combineDateTime(data.date, data.end_time).toISOString(),
    notes: data.notes?.trim() ? data.notes.trim() : undefined,
  };
}

// ─── Reject manual entry ──────────────────────────────────────────────

export const rejectTimeEntrySchema = z.object({
  rejection_reason: z
    .string()
    .min(1, 'Rejection reason is required')
    .max(1000, 'Rejection reason must be 1000 characters or less'),
});

export type RejectTimeEntryFormData = z.infer<typeof rejectTimeEntrySchema>;

// ─── API response shapes ──────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface TimeEntryRef {
  id: string;
  name: string;
  email?: string;
  avatar_url?: string | null;
}

export interface TimeEntryProjectRef {
  id: string;
  name: string;
  color?: string | null;
}

/** A pending manual entry row from `GET /time-entries/pending`. */
export interface PendingTimeEntry {
  id: string;
  approval_status: ApprovalStatus;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  notes: string | null;
  rejection_reason: string | null;
  user: TimeEntryRef | null;
  submitter: TimeEntryRef | null;
  project: TimeEntryProjectRef | null;
}
