/**
 * Role names as they appear in `users.role` and `roles.name`.
 *
 * These are the five system roles PermissionSeeder creates for every organization.
 * The older `'admin'` and `'manager'` names were retired by migration
 * 2026_05_13_000004 and no longer exist in any database.
 */
export const SYSTEM_ROLES = [
  'owner',
  'org_manager',
  'hr_manager',
  'finance_manager',
  'employee',
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

/**
 * A role name coming back from the API.
 *
 * Organizations can define custom roles (see the `settings/roles` page), so the value
 * is not closed over the system set — the union exists for autocomplete and for
 * narrowing, not to promise exhaustiveness. Do not write a `switch` over this without
 * a default branch.
 */
export type UserRole = SystemRole | (string & {});

/** Human-readable label, for when the org's own `display_name` isn't to hand. */
export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  owner: 'Owner',
  org_manager: 'Organization Manager',
  hr_manager: 'HR Manager',
  finance_manager: 'Finance Manager',
  employee: 'Employee / Member',
};

export function isSystemRole(role: string): role is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(role);
}
