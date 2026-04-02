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

export const shiftSwapSchema = z.object({
  target_user_id: z.string().min(1, 'Target user is required'),
  swap_date: z.string().min(1, 'Date is required'),
  reason: z.string().max(1000).nullable().optional(),
});

export type ShiftSwapFormData = z.infer<typeof shiftSwapSchema>;

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
  color: string;
  timezone: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
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

export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ShiftSwapRequest {
  id: string;
  requester_id: string;
  target_user_id: string;
  requester_shift_id: string;
  target_shift_id: string;
  swap_date: string;
  reason: string | null;
  status: SwapStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  requester?: {
    id: string;
    name: string;
    email: string;
  };
  target_user?: {
    id: string;
    name: string;
    email: string;
  };
  requester_shift?: Shift;
  target_shift?: Shift;
  reviewer?: {
    id: string;
    name: string;
  };
  created_at: string;
}

export interface PaginatedSwaps {
  data: ShiftSwapRequest[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface ShiftRosterDay {
  shift: Shift;
  users: {
    id: string;
    name: string;
    email: string;
  }[];
}

export type ShiftRoster = Record<string, ShiftRosterDay[]>;
