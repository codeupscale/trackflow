import { z } from 'zod/v4';
import { employmentTypes, employmentTypeLabels } from './position';

export { employmentTypes, employmentTypeLabels };

export const workModes = ['on_site', 'remote', 'hybrid'] as const;

export const workModeLabels: Record<(typeof workModes)[number], string> = {
  on_site: 'On-site',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

/**
 * Mirrors the server rules in StoreJobPostingRequest + ValidatesJobPostingSalary.
 *
 * The salary comparison runs only when BOTH values are present, so "min only"
 * (From X) and "max only" (Up to Y) both pass — the server does the same thing
 * for the same reason.
 */
export const jobPostingSchema = z
  .object({
    title: z.string().min(1, 'Job title is required').max(255),
    department_id: z.string().uuid('Department is required'),
    position_id: z.string().uuid().nullable().optional(),
    employment_type: z.enum(employmentTypes, {
      error: 'Employment type is required',
    }),
    work_mode: z.enum(workModes, { error: 'Work mode is required' }),
    location: z.string().max(255).nullable().optional(),
    posting_date: z.string().nullable().optional(),
    start_time: z.string().nullable().optional(),
    end_time: z.string().nullable().optional(),
    // Any positive amount; zero and negatives rejected. Mirrors server gt:0.
    min_salary: z
      .number()
      .gt(0, 'Salary must be greater than 0')
      .nullable()
      .optional(),
    max_salary: z
      .number()
      .gt(0, 'Salary must be greater than 0')
      .nullable()
      .optional(),
    send_salary_via_api: z.boolean(),
    short_description: z
      .string()
      .max(500, 'Up to 500 characters')
      .nullable()
      .optional(),
    // Rich text (HTML). The server re-sanitises this against an allow-list on
    // save, so the limit here is only to stop absurd payloads early.
    long_description: z
      .string()
      .max(60000, 'Description is too long')
      .nullable()
      .optional(),
  })
  .refine(
    (d) =>
      d.min_salary == null ||
      d.max_salary == null ||
      d.max_salary > d.min_salary,
    {
      message: 'Maximum salary must be greater than the minimum',
      path: ['max_salary'],
    }
  )
  .refine(
    (d) => !d.send_salary_via_api || d.min_salary != null || d.max_salary != null,
    {
      message: 'Enter a minimum or a maximum salary to publish a salary range',
      path: ['min_salary'],
    }
  )
  .refine((d) => !d.start_time || !d.end_time || d.start_time !== d.end_time, {
    message: 'End time must be different from the start time',
    path: ['end_time'],
  });

export type JobPostingInput = z.infer<typeof jobPostingSchema>;

export interface JobPosting {
  id: string;
  title: string;
  department_id: string;
  position_id: string | null;
  employment_type: (typeof employmentTypes)[number];
  work_mode: (typeof workModes)[number];
  location: string | null;
  posting_date: string | null;
  start_time: string | null;
  end_time: string | null;
  /** Present only for users holding job_postings.view_salary. */
  min_salary?: number | null;
  max_salary?: number | null;
  /** Server-rendered "From X" / "Up to Y" / "X - Y". */
  salary_display?: string | null;
  send_salary_via_api: boolean;
  short_description: string | null;
  /** Sanitised HTML from the server — safe to render. */
  long_description: string | null;
  is_published: boolean;
  department?: { id: string; name: string } | null;
  position?: { id: string; title: string } | null;
  created_at: string;
  updated_at: string;
}

/**
 * True when a posting's date has not arrived yet.
 *
 * Such a posting cannot be published: the careers feed filters on
 * `posting_date <= today`, so publishing it would show "Published" in the
 * portal while candidates saw nothing. Mirrors JobPostingService::isFutureDate().
 *
 * The value is a bare "YYYY-MM-DD" (the server's `date:Y-m-d` cast), so it is
 * split by hand rather than passed to `new Date(value)` — that parses a
 * date-only string as UTC midnight, which reads as the previous day for anyone
 * west of UTC and would wrongly enable Publish a day early.
 */
export function isFuturePostingDate(
  postingDate: string | null | undefined
): boolean {
  if (!postingDate) return false;

  const [year, month, day] = postingDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return new Date(year, month - 1, day).getTime() > today.getTime();
}

/** "2026-08-17" -> "17 Aug 2026". Falls back to the raw value if unparseable. */
export function formatPostingDate(postingDate: string): string {
  const [year, month, day] = postingDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return postingDate;

  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Currency shown alongside salary figures. Display-only — nothing is stored,
 * and the server's salary_display stays currency-free.
 */
export const SALARY_CURRENCY = 'PKR';

/**
 * "150,000 - 200,000" -> "PKR 150,000 - 200,000"
 * "From 200,000"      -> "From PKR 200,000"
 * "Up to 120,000"     -> "Up to PKR 120,000"
 *
 * Inserted before the first digit rather than at the front of the string: a
 * blunt prefix would read "PKR From 200,000".
 */
export function withCurrency(salaryDisplay: string): string;
export function withCurrency(
  salaryDisplay: string | null | undefined
): string | null;
export function withCurrency(
  salaryDisplay: string | null | undefined
): string | null {
  if (!salaryDisplay) return null;

  return salaryDisplay.replace(
    /\d/,
    (firstDigit) => `${SALARY_CURRENCY} ${firstDigit}`
  );
}

/**
 * Client-side twin of JobPosting::salaryDisplay(). Used only as a fallback when
 * the API did not attach salary_display (i.e. the viewer lacks
 * job_postings.view_salary, in which case there is nothing to show anyway).
 */
export function formatSalaryDisplay(
  min?: number | null,
  max?: number | null
): string | null {
  if (min == null && max == null) return null;
  if (min != null && max == null) return `From ${min.toLocaleString()}`;
  if (min == null && max != null) return `Up to ${max.toLocaleString()}`;
  if (min === max) return `${min!.toLocaleString()}`;
  return `${min!.toLocaleString()} - ${max!.toLocaleString()}`;
}
