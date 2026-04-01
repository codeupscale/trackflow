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
  user?: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  };
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
