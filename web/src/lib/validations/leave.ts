import { z } from 'zod/v4';

export const leaveRequestSchema = z.object({
  leave_type_id: z.string().uuid('Please select a leave type'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  reason: z.string().min(1, 'Reason is required').max(1000, 'Reason must be 1000 characters or less'),
  half_day: z.boolean(),
  document: z.instanceof(File).optional().nullable(),
});

export const rejectLeaveSchema = z.object({
  rejection_reason: z.string().min(1, 'Rejection reason is required').max(500, 'Rejection reason must be 500 characters or less'),
});

export const leaveTypeFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  code: z.string().min(1, 'Code is required').max(20),
  type: z.enum(['paid', 'unpaid'], { message: 'Please select paid or unpaid' }),
  days_per_year: z.coerce.number().min(0, 'Must be 0 or more').max(365),
  accrual_method: z.enum(['annual', 'monthly', 'none'], { message: 'Please select an accrual method' }),
  max_carry_over: z.coerce.number().min(0, 'Must be 0 or more').max(365),
  is_active: z.boolean(),
});

export type LeaveRequestFormData = z.infer<typeof leaveRequestSchema>;
export type RejectLeaveFormData = z.infer<typeof rejectLeaveSchema>;
export type LeaveTypeFormData = z.infer<typeof leaveTypeFormSchema>;

// API response types
export interface LeaveType {
  id: string;
  name: string;
  code: string;
  type: 'paid' | 'unpaid';
  days_per_year: number;
  accrual_method: 'annual' | 'monthly' | 'none';
  max_carry_over: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeaveBalance {
  leave_type_id: string;
  total_days: number;
  used_days: number;
  pending_days: number;
  leave_type: {
    id: string;
    name: string;
    code: string;
    type: 'paid' | 'unpaid';
  };
}

export interface LeaveRequestUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface LeaveRequest {
  id: string;
  user_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejection_reason: string | null;
  document_path: string | null;
  user: LeaveRequestUser;
  leave_type: LeaveType;
  approved_by: LeaveRequestUser | null;
  created_at: string;
  updated_at: string;
}

/** A single leave entry within a calendar date bucket (from API) */
export interface LeaveCalendarEntry {
  id: string;
  user: LeaveRequestUser;
  user_name: string;
  leave_type: Pick<LeaveType, 'id' | 'name' | 'code'>;
  leave_type_name: string;
  leave_type_code: string;
  status: 'approved' | 'pending';
  days_count: number;
  half_day: boolean;
  start_date: string;
  end_date: string;
}

/** @deprecated Use LeaveCalendarEntry with the date-keyed calendar object instead */
export interface LeaveCalendarDay {
  date: string;
  leaves: {
    user: LeaveRequestUser;
    leave_type: Pick<LeaveType, 'name' | 'code'>;
    half_day: boolean;
    status: 'approved' | 'pending';
  }[];
}

export interface PublicHoliday {
  id: string;
  name: string;
  date: string;
  is_recurring: boolean;
}
