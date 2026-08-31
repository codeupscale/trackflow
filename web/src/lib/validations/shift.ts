import { z } from 'zod/v4';

// --- Zod Schemas ---

export const shiftSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm format'),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm format'),
  days_of_week: z
    .array(
      z.enum([
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ])
    )
    .min(1, 'Select at least one day'),
  break_minutes: z.coerce
    .number()
    .int()
    .min(0, 'Cannot be negative')
    .max(120, 'Cannot exceed 120 minutes')
    .optional()
    .default(0),
  grace_period_minutes: z.coerce
    .number()
    .int()
    .min(0, 'Cannot be negative')
    .max(60, 'Cannot exceed 60 minutes')
    .optional()
    .default(0),
  allow_early_check_in: z.boolean().optional().default(false),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color')
    .optional()
    .default('#3B82F6'),
  timezone: z.string().optional().default('UTC'),
  description: z.string().max(1000).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

export type ShiftFormData = z.infer<typeof shiftSchema>;

export const shiftAssignmentSchema = z.object({
  user_id: z.string().min(1, 'User is required'),
  effective_from: z.string().min(1, 'Start date is required'),
  effective_to: z.string().nullable().optional(),
});

export type ShiftAssignmentFormData = z.infer<typeof shiftAssignmentSchema>;

// --- API Response Types ---

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface Shift {
  id: string;
  organization_id: string;
  name: string;
  start_time: string;
  end_time: string;
  days_of_week: DayOfWeek[];
  break_minutes: number;
  grace_period_minutes: number;
  allow_early_check_in: boolean;
  color: string;
  timezone: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  /** Who created it. Null on org-owned shifts that predate ownership. */
  creator?: { id: string; name: string } | null;
  created_by?: string | null;
  /**
   * Per-row rights resolved server-side, so the UI never re-derives the
   * ownership rule (a team manager may only edit shifts they created).
   */
  can_edit?: boolean;
  can_delete?: boolean;
}

export interface PaginatedShifts {
  data: Shift[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface ShiftAssignment {
  id: string;
  user_id: string;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface PaginatedAssignments {
  data: ShiftAssignment[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

