-- =============================================================================
-- TrackFlow Role System Migration: 4 roles → 5 roles
-- =============================================================================
-- Migrates every organization from the legacy 4-role system
-- (owner / admin / manager / employee) to the new 5-role system
-- (owner / org_manager / hr_manager / finance_manager / employee).
--
-- SAFETY:
--   • Wrapped in a single transaction — auto-rollback on any error
--   • Idempotent — safe to re-run; already-migrated orgs are skipped
--   • No user data deleted — role assignments are migrated, not destroyed
--   • No system roles deleted before users are re-assigned
--
-- ROLE MAPPING:
--   admin   → org_manager  (rename in-place; keeps same role ID)
--   manager → org_manager  (user_roles redirected, role row deleted)
--   owner   → owner        (unchanged)
--   employee→ employee     (display_name updated only)
--   [new]   → hr_manager
--   [new]   → finance_manager
--
-- RUN ON PRODUCTION:
--   psql -h <host> -U <user> -d trackflow -f role_transition_v2.sql
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop legacy CHECK constraints that would block new role name values
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users        DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE invitations  DROP CONSTRAINT IF EXISTS invitations_role_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Fix the scope constraint on role_permissions
--         Old: scope IN ('own', 'team', 'organization', 'none')
--         New: scope IN ('own', 'project', 'organization', 'none')
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS chk_scope;

-- Rename any existing 'team' scope values before adding new constraint
UPDATE role_permissions SET scope = 'project' WHERE scope = 'team';

ALTER TABLE role_permissions
    ADD CONSTRAINT chk_scope
    CHECK (scope IN ('own', 'project', 'organization', 'none'));

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Mark employees.view_directory as a scoped permission
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE permissions SET has_scope = true WHERE key = 'employees.view_directory';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Remove invalid scope='none' rows for has_scope=true permissions
--         These were seeded incorrectly by an old bug. For scoped permissions,
--         "no access" is represented by the absence of a row, not scope='none'.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE has_scope = true)
  AND scope = 'none';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Rename 'admin' → 'org_manager' in roles table (all orgs)
--         Idempotent: WHERE name='admin' matches 0 rows if already renamed
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE roles
SET
    name         = 'org_manager',
    display_name = 'Organization Manager',
    priority     = 75,
    updated_at   = NOW()
WHERE name = 'admin'
  AND is_system = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Update users.role column
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE users SET role = 'org_manager' WHERE role = 'admin';
UPDATE users SET role = 'org_manager' WHERE role = 'manager';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7: Update invitations.role column
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE invitations SET role = 'org_manager' WHERE role IN ('admin', 'manager');

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8: Migrate 'manager' user_roles → 'org_manager'
--         For each org: redirect user_roles rows from the old manager role
--         to the org's org_manager role, preventing duplicate assignments.
--         Then clean up the now-empty manager role.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    org_rec          RECORD;
    mgr_role_id      UUID;
    org_mgr_role_id  UUID;
BEGIN
    FOR org_rec IN SELECT id FROM organizations LOOP
        SELECT id INTO mgr_role_id
        FROM roles
        WHERE organization_id = org_rec.id AND name = 'manager' AND is_system = true;

        SELECT id INTO org_mgr_role_id
        FROM roles
        WHERE organization_id = org_rec.id AND name = 'org_manager' AND is_system = true;

        IF mgr_role_id IS NOT NULL AND org_mgr_role_id IS NOT NULL THEN
            -- Move manager assignments to org_manager (skip if user already has org_manager)
            UPDATE user_roles
            SET role_id = org_mgr_role_id
            WHERE role_id = mgr_role_id
              AND user_id NOT IN (
                  SELECT user_id FROM user_roles WHERE role_id = org_mgr_role_id
              );

            -- Delete any remaining manager assignments (duplicates that were skipped above)
            DELETE FROM user_roles WHERE role_id = mgr_role_id;

            -- Delete manager role_permissions (or let cascade handle it below)
            DELETE FROM role_permissions WHERE role_id = mgr_role_id;

            -- Delete the manager role itself
            DELETE FROM roles WHERE id = mgr_role_id;
        END IF;
    END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9: Update employee display_name
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE roles
SET display_name = 'Employee / Member', updated_at = NOW()
WHERE name = 'employee' AND is_system = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 10: Create hr_manager and finance_manager roles for every organization.
--          Also create all 5 roles for any org that is missing them entirely
--          (orgs created after the RBAC system was introduced but before seeding
--          was run for them — their owners currently have no user_roles entries).
--          ON CONFLICT DO NOTHING makes this idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    org_rec RECORD;
BEGIN
    FOR org_rec IN SELECT id FROM organizations LOOP

        -- owner
        INSERT INTO roles (id, organization_id, name, display_name, is_system, is_default, priority, created_at, updated_at)
        VALUES (gen_random_uuid(), org_rec.id, 'owner', 'Owner', true, false, 100, NOW(), NOW())
        ON CONFLICT (organization_id, name) DO NOTHING;

        -- org_manager
        INSERT INTO roles (id, organization_id, name, display_name, is_system, is_default, priority, created_at, updated_at)
        VALUES (gen_random_uuid(), org_rec.id, 'org_manager', 'Organization Manager', true, false, 75, NOW(), NOW())
        ON CONFLICT (organization_id, name) DO NOTHING;

        -- hr_manager (new)
        INSERT INTO roles (id, organization_id, name, display_name, is_system, is_default, priority, created_at, updated_at)
        VALUES (gen_random_uuid(), org_rec.id, 'hr_manager', 'HR Manager', true, false, 65, NOW(), NOW())
        ON CONFLICT (organization_id, name) DO NOTHING;

        -- finance_manager (new)
        INSERT INTO roles (id, organization_id, name, display_name, is_system, is_default, priority, created_at, updated_at)
        VALUES (gen_random_uuid(), org_rec.id, 'finance_manager', 'Finance Manager', true, false, 60, NOW(), NOW())
        ON CONFLICT (organization_id, name) DO NOTHING;

        -- employee
        INSERT INTO roles (id, organization_id, name, display_name, is_system, is_default, priority, created_at, updated_at)
        VALUES (gen_random_uuid(), org_rec.id, 'employee', 'Employee / Member', true, true, 10, NOW(), NOW())
        ON CONFLICT (organization_id, name) DO NOTHING;

    END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 11: Backfill user_roles for users who have a role in users.role
--          but no corresponding entry in user_roles.
--          This covers owners of newly-created orgs that never got RBAC seeded.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO user_roles (id, user_id, role_id, assigned_by, assigned_at)
SELECT
    gen_random_uuid(),
    u.id,
    r.id,
    NULL,
    NOW()
FROM users u
JOIN roles r ON r.organization_id = u.organization_id
           AND r.name = u.role
           AND r.is_system = true
WHERE NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 12: Clear all role_permissions for system roles.
--          We re-seed the complete, correct permission set for every role
--          so that any stale/incorrect permissions from previous seedings
--          are replaced. Owner gets NO rows (bypass is handled in code).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM role_permissions
WHERE role_id IN (
    SELECT id FROM roles WHERE is_system = true
);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 13: Seed org_manager permissions (all orgs)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (id, role_id, permission_id, scope, created_at)
SELECT
    gen_random_uuid(),
    r.id,
    p.id,
    CASE p.key
        WHEN 'time_entries.view'              THEN 'organization'
        WHEN 'time_entries.create'            THEN 'organization'
        WHEN 'time_entries.edit'              THEN 'organization'
        WHEN 'time_entries.delete'            THEN 'organization'
        WHEN 'time_entries.approve'           THEN 'organization'
        WHEN 'time_entries.export'            THEN 'organization'
        WHEN 'screenshots.view'               THEN 'organization'
        WHEN 'screenshots.delete'             THEN 'organization'
        WHEN 'screenshots.manage_settings'    THEN 'none'
        WHEN 'projects.view'                  THEN 'organization'
        WHEN 'projects.create'                THEN 'none'
        WHEN 'projects.edit'                  THEN 'organization'
        WHEN 'projects.delete'                THEN 'organization'
        WHEN 'projects.manage_members'        THEN 'organization'
        WHEN 'reports.view'                   THEN 'organization'
        WHEN 'reports.export'                 THEN 'organization'
        WHEN 'dashboard.view_own_stats'       THEN 'none'
        WHEN 'dashboard.view_team_stats'      THEN 'none'
        WHEN 'departments.view'               THEN 'none'
        WHEN 'departments.create'             THEN 'none'
        WHEN 'departments.edit'               THEN 'none'
        WHEN 'departments.delete'             THEN 'none'
        WHEN 'positions.view'                 THEN 'none'
        WHEN 'positions.create'               THEN 'none'
        WHEN 'positions.edit'                 THEN 'none'
        WHEN 'positions.delete'               THEN 'none'
        WHEN 'positions.view_salary'          THEN 'none'
        WHEN 'employees.view_directory'       THEN 'organization'
        WHEN 'employees.view_profile'         THEN 'organization'
        WHEN 'employees.edit_profile'         THEN 'organization'
        WHEN 'employees.view_financial'       THEN 'organization'
        WHEN 'employees.manage_documents'     THEN 'organization'
        WHEN 'employees.manage_notes'         THEN 'organization'
        WHEN 'leave.apply'                    THEN 'none'
        WHEN 'leave.view_requests'            THEN 'organization'
        WHEN 'leave.approve'                  THEN 'organization'
        WHEN 'leave.cancel'                   THEN 'organization'
        WHEN 'leave.view_calendar'            THEN 'organization'
        WHEN 'leave.manage_types'             THEN 'none'
        WHEN 'leave.manage_balances'          THEN 'none'
        WHEN 'leave.manage_holidays'          THEN 'none'
        WHEN 'attendance.view'                THEN 'organization'
        WHEN 'attendance.generate'            THEN 'none'
        WHEN 'attendance.regularize'          THEN 'none'
        WHEN 'attendance.approve_regularizations' THEN 'organization'
        WHEN 'attendance.manage_overtime_rules'   THEN 'none'
        WHEN 'payroll.view_own'               THEN 'none'
        WHEN 'payroll.view_team'              THEN 'none'
        WHEN 'payroll.view_all'               THEN 'none'
        WHEN 'payroll.run'                    THEN 'none'
        WHEN 'payroll.manage_structures'      THEN 'none'
        WHEN 'payroll.manage_components'      THEN 'none'
        WHEN 'payroll.approve'                THEN 'none'
        WHEN 'shifts.view'                    THEN 'none'
        WHEN 'shifts.create'                  THEN 'none'
        WHEN 'shifts.edit'                    THEN 'none'
        WHEN 'shifts.delete'                  THEN 'none'
        WHEN 'shifts.manage_assignments'      THEN 'none'
        WHEN 'shifts.manage_swaps'            THEN 'none'
        WHEN 'team.view_members'              THEN 'none'
        WHEN 'team.invite'                    THEN 'none'
        WHEN 'team.remove'                    THEN 'none'
        WHEN 'team.change_role'               THEN 'none'
        WHEN 'settings.view_org'              THEN 'none'
        WHEN 'settings.edit_org'              THEN 'none'
        WHEN 'settings.edit_tracking'         THEN 'none'
        WHEN 'audit_logs.view'                THEN 'none'
        WHEN 'roles.view'                     THEN 'none'
    END,
    NOW()
FROM roles r
JOIN permissions p ON p.key IN (
    'time_entries.view', 'time_entries.create', 'time_entries.edit',
    'time_entries.delete', 'time_entries.approve', 'time_entries.export',
    'screenshots.view', 'screenshots.delete', 'screenshots.manage_settings',
    'projects.view', 'projects.create', 'projects.edit', 'projects.delete',
    'projects.manage_members',
    'reports.view', 'reports.export',
    'dashboard.view_own_stats', 'dashboard.view_team_stats',
    'departments.view', 'departments.create', 'departments.edit', 'departments.delete',
    'positions.view', 'positions.create', 'positions.edit', 'positions.delete',
    'positions.view_salary',
    'employees.view_directory', 'employees.view_profile', 'employees.edit_profile',
    'employees.view_financial', 'employees.manage_documents', 'employees.manage_notes',
    'leave.apply', 'leave.view_requests', 'leave.approve', 'leave.cancel',
    'leave.view_calendar', 'leave.manage_types', 'leave.manage_balances',
    'leave.manage_holidays',
    'attendance.view', 'attendance.generate', 'attendance.regularize',
    'attendance.approve_regularizations', 'attendance.manage_overtime_rules',
    'payroll.view_own', 'payroll.view_team', 'payroll.view_all', 'payroll.run',
    'payroll.manage_structures', 'payroll.manage_components', 'payroll.approve',
    'shifts.view', 'shifts.create', 'shifts.edit', 'shifts.delete',
    'shifts.manage_assignments', 'shifts.manage_swaps',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_role',
    'settings.view_org', 'settings.edit_org', 'settings.edit_tracking',
    'audit_logs.view', 'roles.view'
)
WHERE r.name = 'org_manager' AND r.is_system = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 14: Seed hr_manager permissions (all orgs)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (id, role_id, permission_id, scope, created_at)
SELECT
    gen_random_uuid(),
    r.id,
    p.id,
    CASE p.key
        WHEN 'dashboard.view_own_stats'           THEN 'none'
        WHEN 'dashboard.view_team_stats'          THEN 'none'
        WHEN 'time_entries.view'                  THEN 'organization'
        WHEN 'time_entries.export'                THEN 'organization'
        WHEN 'screenshots.view'                   THEN 'organization'
        WHEN 'reports.view'                       THEN 'organization'
        WHEN 'reports.export'                     THEN 'organization'
        WHEN 'departments.view'                   THEN 'none'
        WHEN 'departments.create'                 THEN 'none'
        WHEN 'departments.edit'                   THEN 'none'
        WHEN 'departments.delete'                 THEN 'none'
        WHEN 'positions.view'                     THEN 'none'
        WHEN 'positions.create'                   THEN 'none'
        WHEN 'positions.edit'                     THEN 'none'
        WHEN 'positions.delete'                   THEN 'none'
        WHEN 'positions.view_salary'              THEN 'none'
        WHEN 'employees.view_directory'           THEN 'organization'
        WHEN 'employees.view_profile'             THEN 'organization'
        WHEN 'employees.edit_profile'             THEN 'organization'
        WHEN 'employees.view_financial'           THEN 'organization'
        WHEN 'employees.manage_documents'         THEN 'organization'
        WHEN 'employees.manage_notes'             THEN 'organization'
        WHEN 'leave.apply'                        THEN 'none'
        WHEN 'leave.view_requests'                THEN 'organization'
        WHEN 'leave.approve'                      THEN 'organization'
        WHEN 'leave.cancel'                       THEN 'organization'
        WHEN 'leave.view_calendar'                THEN 'organization'
        WHEN 'leave.manage_types'                 THEN 'none'
        WHEN 'leave.manage_balances'              THEN 'none'
        WHEN 'leave.manage_holidays'              THEN 'none'
        WHEN 'attendance.view'                    THEN 'organization'
        WHEN 'attendance.generate'                THEN 'none'
        WHEN 'attendance.regularize'              THEN 'none'
        WHEN 'attendance.approve_regularizations' THEN 'organization'
        WHEN 'attendance.manage_overtime_rules'   THEN 'none'
        WHEN 'payroll.view_own'                   THEN 'none'
        WHEN 'payroll.view_team'                  THEN 'none'
        WHEN 'payroll.view_all'                   THEN 'none'
        WHEN 'shifts.view'                        THEN 'none'
        WHEN 'shifts.create'                      THEN 'none'
        WHEN 'shifts.edit'                        THEN 'none'
        WHEN 'shifts.delete'                      THEN 'none'
        WHEN 'shifts.manage_assignments'          THEN 'none'
        WHEN 'shifts.manage_swaps'                THEN 'none'
        WHEN 'team.view_members'                  THEN 'none'
        WHEN 'team.invite'                        THEN 'none'
        WHEN 'settings.view_org'                  THEN 'none'
        WHEN 'audit_logs.view'                    THEN 'none'
        WHEN 'roles.view'                         THEN 'none'
    END,
    NOW()
FROM roles r
JOIN permissions p ON p.key IN (
    'dashboard.view_own_stats', 'dashboard.view_team_stats',
    'time_entries.view', 'time_entries.export',
    'screenshots.view',
    'reports.view', 'reports.export',
    'departments.view', 'departments.create', 'departments.edit', 'departments.delete',
    'positions.view', 'positions.create', 'positions.edit', 'positions.delete',
    'positions.view_salary',
    'employees.view_directory', 'employees.view_profile', 'employees.edit_profile',
    'employees.view_financial', 'employees.manage_documents', 'employees.manage_notes',
    'leave.apply', 'leave.view_requests', 'leave.approve', 'leave.cancel',
    'leave.view_calendar', 'leave.manage_types', 'leave.manage_balances',
    'leave.manage_holidays',
    'attendance.view', 'attendance.generate', 'attendance.regularize',
    'attendance.approve_regularizations', 'attendance.manage_overtime_rules',
    'payroll.view_own', 'payroll.view_team', 'payroll.view_all',
    'shifts.view', 'shifts.create', 'shifts.edit', 'shifts.delete',
    'shifts.manage_assignments', 'shifts.manage_swaps',
    'team.view_members', 'team.invite',
    'settings.view_org',
    'audit_logs.view',
    'roles.view'
)
WHERE r.name = 'hr_manager' AND r.is_system = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 15: Seed finance_manager permissions (all orgs)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (id, role_id, permission_id, scope, created_at)
SELECT
    gen_random_uuid(),
    r.id,
    p.id,
    CASE p.key
        WHEN 'dashboard.view_own_stats'   THEN 'none'
        WHEN 'dashboard.view_team_stats'  THEN 'none'
        WHEN 'time_entries.view'          THEN 'organization'
        WHEN 'time_entries.export'        THEN 'organization'
        WHEN 'reports.view'               THEN 'organization'
        WHEN 'reports.export'             THEN 'organization'
        WHEN 'positions.view_salary'      THEN 'none'
        WHEN 'employees.view_directory'   THEN 'organization'
        WHEN 'employees.view_profile'     THEN 'organization'
        WHEN 'employees.view_financial'   THEN 'organization'
        WHEN 'employees.manage_documents' THEN 'organization'
        WHEN 'leave.apply'                THEN 'none'
        WHEN 'leave.view_requests'        THEN 'organization'
        WHEN 'leave.view_calendar'        THEN 'organization'
        WHEN 'attendance.view'            THEN 'organization'
        WHEN 'attendance.regularize'      THEN 'none'
        WHEN 'payroll.view_own'           THEN 'none'
        WHEN 'payroll.view_team'          THEN 'none'
        WHEN 'payroll.view_all'           THEN 'none'
        WHEN 'payroll.run'                THEN 'none'
        WHEN 'payroll.manage_structures'  THEN 'none'
        WHEN 'payroll.manage_components'  THEN 'none'
        WHEN 'payroll.approve'            THEN 'none'
        WHEN 'shifts.view'                THEN 'none'
        WHEN 'team.view_members'          THEN 'none'
        WHEN 'settings.view_org'          THEN 'none'
        WHEN 'settings.manage_billing'    THEN 'none'
        WHEN 'audit_logs.view'            THEN 'none'
    END,
    NOW()
FROM roles r
JOIN permissions p ON p.key IN (
    'dashboard.view_own_stats', 'dashboard.view_team_stats',
    'time_entries.view', 'time_entries.export',
    'reports.view', 'reports.export',
    'positions.view_salary',
    'employees.view_directory', 'employees.view_profile',
    'employees.view_financial', 'employees.manage_documents',
    'leave.apply', 'leave.view_requests', 'leave.view_calendar',
    'attendance.view', 'attendance.regularize',
    'payroll.view_own', 'payroll.view_team', 'payroll.view_all',
    'payroll.run', 'payroll.manage_structures', 'payroll.manage_components',
    'payroll.approve',
    'shifts.view',
    'team.view_members',
    'settings.view_org', 'settings.manage_billing',
    'audit_logs.view'
)
WHERE r.name = 'finance_manager' AND r.is_system = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 16: Seed employee permissions (all orgs)
--          Note: has_scope=true permissions use real scopes (own/project).
--          has_scope=false permissions use 'none'.
--          Step 4 above already deleted any rows with scope='none' for scoped
--          permissions, so all re-inserted rows here are valid.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (id, role_id, permission_id, scope, created_at)
SELECT
    gen_random_uuid(),
    r.id,
    p.id,
    CASE p.key
        WHEN 'time_entries.view'         THEN 'own'
        WHEN 'time_entries.create'       THEN 'own'
        WHEN 'time_entries.edit'         THEN 'own'
        WHEN 'time_entries.export'       THEN 'own'
        WHEN 'screenshots.view'          THEN 'own'
        WHEN 'projects.view'             THEN 'own'
        WHEN 'reports.view'              THEN 'own'
        WHEN 'reports.export'            THEN 'own'
        WHEN 'dashboard.view_own_stats'  THEN 'none'
        WHEN 'departments.view'          THEN 'none'
        WHEN 'employees.view_directory'  THEN 'own'
        WHEN 'employees.view_profile'    THEN 'own'
        WHEN 'employees.edit_profile'    THEN 'own'
        WHEN 'employees.view_financial'  THEN 'own'
        WHEN 'employees.manage_documents'THEN 'own'
        WHEN 'leave.apply'               THEN 'none'
        WHEN 'leave.view_requests'       THEN 'own'
        WHEN 'leave.cancel'              THEN 'own'
        WHEN 'leave.view_calendar'       THEN 'project'
        WHEN 'attendance.view'           THEN 'own'
        WHEN 'attendance.regularize'     THEN 'none'
        WHEN 'payroll.view_own'          THEN 'none'
        WHEN 'shifts.view'               THEN 'none'
    END,
    NOW()
FROM roles r
JOIN permissions p ON p.key IN (
    'time_entries.view', 'time_entries.create', 'time_entries.edit',
    'time_entries.export',
    'screenshots.view',
    'projects.view',
    'reports.view', 'reports.export',
    'dashboard.view_own_stats',
    'departments.view',
    'employees.view_directory', 'employees.view_profile', 'employees.edit_profile',
    'employees.view_financial', 'employees.manage_documents',
    'leave.apply', 'leave.view_requests', 'leave.cancel', 'leave.view_calendar',
    'attendance.view', 'attendance.regularize',
    'payroll.view_own',
    'shifts.view'
)
WHERE r.name = 'employee' AND r.is_system = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 17: Verify — print a summary (psql will show this in output)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    org_count        INT;
    role_count       INT;
    user_count       INT;
    perm_count       INT;
    orphan_count     INT;
    bad_role_count   INT;
BEGIN
    SELECT count(*) INTO org_count  FROM organizations;
    SELECT count(*) INTO role_count FROM roles WHERE is_system = true;
    SELECT count(*) INTO user_count FROM users;
    SELECT count(*) INTO perm_count FROM role_permissions;

    -- Check for user_roles orphans (user has no role assignment)
    SELECT count(*) INTO orphan_count
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id);

    -- Check for users still on old role names
    SELECT count(*) INTO bad_role_count
    FROM users WHERE role IN ('admin', 'manager');

    RAISE NOTICE '=== Role Migration Summary ===';
    RAISE NOTICE 'Organizations : %', org_count;
    RAISE NOTICE 'System roles  : % (expected %)', role_count, org_count * 5;
    RAISE NOTICE 'Users         : %', user_count;
    RAISE NOTICE 'Role perms    : %', perm_count;
    RAISE NOTICE 'Users w/o role assignment : %  (should be 0)', orphan_count;
    RAISE NOTICE 'Users with old role names : %  (should be 0)', bad_role_count;

    IF orphan_count > 0 OR bad_role_count > 0 THEN
        RAISE EXCEPTION 'Migration check failed — orphan_count=%, bad_role_count=%',
            orphan_count, bad_role_count;
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- Done. Run `php artisan migrate` next to apply the remaining Laravel schema
-- migrations (column type changes, constraint updates, etc.).
-- =============================================================================
