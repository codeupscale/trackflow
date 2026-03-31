import { z } from 'zod/v4';

export const positionLevels = [
  'junior',
  'mid',
  'senior',
  'lead',
  'manager',
  'director',
  'vp',
  'c_level',
] as const;

export const employmentTypes = [
  'full_time',
  'part_time',
  'contract',
  'intern',
] as const;

export const positionSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(255),
    code: z.string().min(1, 'Code is required').max(50),
    department_id: z.string().uuid('Department is required'),
    level: z.enum(positionLevels, { error: 'Level is required' }),
    employment_type: z.enum(employmentTypes, {
      error: 'Employment type is required',
    }),
    min_salary: z.number().min(0).optional().nullable(),
    max_salary: z.number().min(0).optional().nullable(),
    is_active: z.boolean(),
  })
  .refine(
    (d) => !d.min_salary || !d.max_salary || d.max_salary >= d.min_salary,
    {
      message: 'Max salary must be >= min salary',
      path: ['max_salary'],
    }
  );

export type PositionInput = z.infer<typeof positionSchema>;

export interface Position {
  id: string;
  title: string;
  code: string;
  department_id: string;
  level: (typeof positionLevels)[number];
  employment_type: (typeof employmentTypes)[number];
  min_salary: number | null;
  max_salary: number | null;
  is_active: boolean;
  department?: {
    id: string;
    name: string;
    code: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export const positionLevelLabels: Record<
  (typeof positionLevels)[number],
  string
> = {
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
  manager: 'Manager',
  director: 'Director',
  vp: 'VP',
  c_level: 'C-Level',
};

export const employmentTypeLabels: Record<
  (typeof employmentTypes)[number],
  string
> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  intern: 'Intern',
};
