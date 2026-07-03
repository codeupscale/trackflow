import { z } from 'zod/v4';

// --- Zod Schemas ---

export const regularizationSchema = z.object({
  attendance_record_id: z.string().min(1, 'Attendance record is required'),
  requested_status: z.enum(['present', 'half_day'], {
    message: 'Please select a valid status',
  }),
  reason: z
    .string()
    .min(1, 'Reason is required')
    .max(500, 'Reason must be 500 characters or less'),
});

export const overtimeRuleSchema = z.object({
  daily_threshold_hours: z.coerce
    .number()
    .min(1, 'Must be at least 1 hour')
    .max(24, 'Cannot exceed 24 hours'),
  weekly_threshold_hours: z.coerce
    .number()
    .min(1, 'Must be at least 1 hour')
    .max(168, 'Cannot exceed 168 hours'),
  overtime_multiplier: z.coerce
    .number()
    .min(1, 'Multiplier must be at least 1x')
    .max(5, 'Multiplier cannot exceed 5x'),
  weekend_multiplier: z.coerce
    .number()
    .min(1, 'Multiplier must be at least 1x')
    .max(5, 'Multiplier cannot exceed 5x'),
});

export type RegularizationFormData = z.infer<typeof regularizationSchema>;
export type OvertimeRuleFormData = z.infer<typeof overtimeRuleSchema>;

// --- API Response Types ---

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'on_leave'
  | 'holiday'
  | 'weekend';

// --- Check-in / Checkout ---

export type CheckInStatus = 'on_time' | 'late' | null;

/**
 * Advisory flags attached to a check-in record. All keys are optional booleans;
 * the object is null when no flags apply.
 */
export interface CheckInFlags {
  on_approved_leave?: boolean;
  worked_on_off_day?: boolean;
  auto_closed?: boolean;
}

export interface AttendanceRecord {
  id: string;
  user_id: string;
  date: string;
  day: string;
  status: AttendanceStatus;
  shift_name: string | null;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number;
  late_minutes: number;
  overtime_hours: number;
  is_regularized: boolean;
  regularization_status: 'pending' | 'approved' | 'rejected' | null;
  // Check-in / checkout fields (present on check-ins list rows)
  check_in_at?: string | null;
  check_out_at?: string | null;
  worked_seconds?: number | null;
  worked_hhmm?: string | null;
  check_in_status?: CheckInStatus;
  is_early_checkout?: boolean;
  missing_checkout?: boolean;
  check_in_flags?: CheckInFlags | null;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  };
}

export interface AttendancePolicy {
  check_in_time: string;
  late_threshold: string;
  checkout_time: string;
  timezone: string;
  allow_early_check_in: boolean;
  is_active: boolean;
}

export interface TodayStatus {
  checked_in: boolean;
  checked_out: boolean;
  check_in_at: string | null;
  check_in_at_local: string | null;
  check_out_at: string | null;
  check_out_at_local?: string | null;
  check_in_status: CheckInStatus;
  check_in_late_minutes?: number;
  is_early_checkout: boolean;
  check_out_early_minutes?: number;
  check_out_overtime_minutes?: number;
  missing_checkout?: boolean;
  worked_seconds: number | null;
  worked_hhmm: string | null;
  status: AttendanceStatus | null;
  check_in_flags: CheckInFlags | null;
  server_now: string;
  policy: Pick<
    AttendancePolicy,
    'check_in_time' | 'late_threshold' | 'checkout_time' | 'timezone'
  >;
}

export interface CheckInSummaryRow {
  user: {
    id: string;
    name: string;
    email: string;
  };
  total_worked_seconds: number;
  worked_hhmm: string;
  days_present: number;
  late_count: number;
  early_checkout_count: number;
  missing_checkout_count: number;
}

export interface PaginatedCheckInSummary {
  data: CheckInSummaryRow[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface AttendanceSummary {
  month: number;
  year: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  half_days: number;
  on_leave_days: number;
  overtime_hours: number;
  total_working_days: number;
}

export interface AttendanceRegularization {
  id: string;
  attendance_record_id: string;
  user_id: string;
  current_status: AttendanceStatus;
  requested_status: 'present' | 'half_day';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  };
  reviewer?: {
    id: string;
    name: string;
  } | null;
  attendance_record: {
    id: string;
    date: string;
    status: AttendanceStatus;
  };
  created_at: string;
  updated_at: string;
}

export interface OvertimeRule {
  id: string;
  organization_id: string;
  daily_threshold_hours: number;
  weekly_threshold_hours: number;
  overtime_multiplier: number;
  weekend_multiplier: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedAttendance {
  data: AttendanceRecord[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}

export interface PaginatedRegularizations {
  data: AttendanceRegularization[];
  current_page: number;
  last_page: number;
  total: number;
  from: number | null;
  to: number | null;
}
