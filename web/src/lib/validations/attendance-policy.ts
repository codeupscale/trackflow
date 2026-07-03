import { z } from 'zod/v4';

// Accepts HH:MM or HH:MM:SS (24-hour). The backend stores HH:MM:SS but validates
// both formats; the browser <input type="time"> emits HH:MM.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Normalize a time string to seconds-since-midnight for ordering comparisons.
function timeToSeconds(value: string): number {
  const [h = '0', m = '0', s = '0'] = value.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export const attendancePolicySchema = z
  .object({
    check_in_time: z
      .string()
      .regex(TIME_RE, 'Enter a valid time (HH:MM)'),
    late_threshold: z
      .string()
      .regex(TIME_RE, 'Enter a valid time (HH:MM)'),
    checkout_time: z
      .string()
      .regex(TIME_RE, 'Enter a valid time (HH:MM)'),
    timezone: z.string().min(1, 'Timezone is required'),
    allow_early_check_in: z.boolean(),
  })
  // Mirror the server ordering rules: late_threshold >= check_in_time.
  .refine(
    (d) => timeToSeconds(d.late_threshold) >= timeToSeconds(d.check_in_time),
    {
      message: 'The late threshold must be at or after the check-in time.',
      path: ['late_threshold'],
    }
  )
  // checkout_time > late_threshold.
  .refine(
    (d) => timeToSeconds(d.checkout_time) > timeToSeconds(d.late_threshold),
    {
      message: 'The checkout time must be after the late threshold.',
      path: ['checkout_time'],
    }
  );

export type AttendancePolicyFormData = z.infer<typeof attendancePolicySchema>;
