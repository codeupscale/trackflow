import { z } from 'zod/v4';

export const departmentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  code: z.string().min(1, 'Code is required').max(50),
  description: z.string().optional(),
  parent_department_id: z.string().uuid().optional().nullable(),
  manager_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean(),
});

export type DepartmentInput = z.infer<typeof departmentSchema>;

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parent_department_id: string | null;
  manager_id: string | null;
  is_active: boolean;
  positions_count: number;
  parent_department?: Department | null;
  manager?: {
    id: string;
    name: string;
    email: string;
  } | null;
  children?: Department[];
  created_at: string;
  updated_at: string;
}
