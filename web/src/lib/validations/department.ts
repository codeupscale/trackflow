import { z } from 'zod/v4';

/**
 * Palette for department code badges. Shared so the listing table and the
 * detail modal colour the SAME code identically — a code that is amber in the
 * list must not turn grey when the row is opened.
 */
const CODE_BADGE_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400',
];

/**
 * Deterministic colour for a department code — the same code always maps to the
 * same swatch, so colours stay stable across renders, pages and reloads.
 */
export function codeBadgeColor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = code.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CODE_BADGE_COLORS[Math.abs(hash) % CODE_BADGE_COLORS.length];
}

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
