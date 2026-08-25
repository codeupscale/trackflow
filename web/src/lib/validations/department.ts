import { z } from 'zod/v4';

/**
 * Re-exported for existing callers. The implementation moved to lib/utils once
 * leave types started using it too — it is not department-specific.
 */
export { codeBadgeColor } from '@/lib/utils';

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
  /**
   * Live headcount of ACTIVE users assigned to this department, sent by every
   * department read path (list, show, tree). Counted from employee_profiles —
   * NOT from the dead `head_count` column, which nothing ever writes.
   */
  employees_count: number;
  /**
   * Optional because no API endpoint actually sends it — the backend eager-loads
   * `positions` but never adds a withCount, so this was always undefined and the
   * old Positions column rendered a hardcoded 0.
   */
  positions_count?: number;
  /**
   * The parent department, eager-loaded as `parent` — that is the relation name
   * on the Eloquent model, so this is the key the API actually sends.
   * `parent_department` below never populated and is kept only so older callers
   * still typecheck; read `parent`.
   */
  parent?: { id: string; name: string; code: string } | null;
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
