<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PermissionSeeder extends Seeder
{
    /**
     * All 59 permissions in the system.
     * Format: [key, module, action, description, has_scope]
     */
    public function getPermissions(): array
    {
        return [
            // --- time_entries (6) ---
            ['time_entries.view',   'time_entries', 'view',    'View time entries',                          true],
            ['time_entries.create', 'time_entries', 'create',  'Create manual time entries',                 true],
            ['time_entries.edit',   'time_entries', 'edit',    'Edit time entries',                          true],
            ['time_entries.delete', 'time_entries', 'delete',  'Delete time entries',                        true],
            ['time_entries.approve','time_entries', 'approve', 'Approve manual/edited time entries',         true],
            ['time_entries.export', 'time_entries', 'export',  'Export time data',                           true],

            // --- screenshots (3) ---
            ['screenshots.view',            'screenshots', 'view',            'View screenshot captures',                    true],
            ['screenshots.delete',          'screenshots', 'delete',          'Delete screenshots',                          true],
            ['screenshots.manage_settings', 'screenshots', 'manage_settings', 'Configure blur, frequency, capture mode',     false],

            // --- projects (5) ---
            ['projects.view',           'projects', 'view',           'View project list and details',          true],
            ['projects.create',         'projects', 'create',         'Create new projects',                    false],
            ['projects.edit',           'projects', 'edit',           'Edit project details',                   true],
            ['projects.delete',         'projects', 'delete',         'Delete or archive projects',             true],
            ['projects.manage_members', 'projects', 'manage_members', 'Add or remove members to projects',     true],

            // --- reports (2) ---
            ['reports.view',   'reports', 'view',   'Access reports section',    true],
            ['reports.export', 'reports', 'export', 'Export reports as CSV/PDF', true],

            // --- dashboard (2) ---
            ['dashboard.view_own_stats',  'dashboard', 'view_own_stats',  'See own time, activity, projects',        false],
            ['dashboard.view_team_stats', 'dashboard', 'view_team_stats', 'See team overview cards and charts',      false],

            // --- departments (4) ---
            ['departments.view',   'departments', 'view',   'View department list and tree', false],
            ['departments.create', 'departments', 'create', 'Create new departments',       false],
            ['departments.edit',   'departments', 'edit',   'Edit department details',       false],
            ['departments.delete', 'departments', 'delete', 'Archive or delete departments', false],

            // --- positions (5) ---
            ['positions.view',        'positions', 'view',        'View position list',                            false],
            ['positions.create',      'positions', 'create',      'Create new positions',                          false],
            ['positions.edit',        'positions', 'edit',        'Edit position details including salary bands',  false],
            ['positions.delete',      'positions', 'delete',      'Archive or delete positions',                   false],
            ['positions.view_salary', 'positions', 'view_salary', 'View min/max salary encrypted fields',         false],

            // --- employees (6) ---
            ['employees.view_directory',   'employees', 'view_directory',   'View employee directory',             false],
            ['employees.view_profile',     'employees', 'view_profile',     'View full employee profile',          true],
            ['employees.edit_profile',     'employees', 'edit_profile',     'Edit employee profile fields',        true],
            ['employees.view_financial',   'employees', 'view_financial',   'View bank details and tax ID',        true],
            ['employees.manage_documents', 'employees', 'manage_documents', 'Upload, verify, delete documents',    true],
            ['employees.manage_notes',     'employees', 'manage_notes',     'Create, view, delete notes',          true],

            // --- leave (8) ---
            ['leave.apply',           'leave', 'apply',           'Apply for leave',                       false],
            ['leave.view_requests',   'leave', 'view_requests',   'View leave requests',                   true],
            ['leave.approve',         'leave', 'approve',         'Approve or reject leave requests',      true],
            ['leave.cancel',          'leave', 'cancel',          'Cancel leave requests',                 true],
            ['leave.view_calendar',   'leave', 'view_calendar',   'View leave calendar',                   true],
            ['leave.manage_types',    'leave', 'manage_types',    'Create, edit, delete leave types',      false],
            ['leave.manage_balances', 'leave', 'manage_balances', 'Adjust leave balances manually',        false],
            ['leave.manage_holidays', 'leave', 'manage_holidays', 'Create, edit, delete public holidays',  false],

            // --- attendance (5) ---
            ['attendance.view',                     'attendance', 'view',                     'View attendance records',              true],
            ['attendance.generate',                 'attendance', 'generate',                 'Trigger daily attendance generation',  false],
            ['attendance.regularize',               'attendance', 'regularize',               'Submit regularization requests',       false],
            ['attendance.approve_regularizations',  'attendance', 'approve_regularizations',  'Approve or reject regularizations',   true],
            ['attendance.manage_overtime_rules',    'attendance', 'manage_overtime_rules',    'Configure overtime rules',            false],

            // --- payroll (7) ---
            ['payroll.view_own',           'payroll', 'view_own',           'View own payslips',                               false],
            ['payroll.view_team',          'payroll', 'view_team',          'View direct reports payslips',                     false],
            ['payroll.view_all',           'payroll', 'view_all',           'View all payroll data',                            false],
            ['payroll.run',                'payroll', 'run',                'Run payroll for a period',                         false],
            ['payroll.manage_structures',  'payroll', 'manage_structures',  'Create and edit salary structures',                false],
            ['payroll.manage_components',  'payroll', 'manage_components',  'Manage pay components (allowances, deductions)',   false],
            ['payroll.approve',            'payroll', 'approve',            'Approve and finalize payslips',                    false],

            // --- shifts (6) ---
            ['shifts.view',                'shifts', 'view',                'View shifts and roster',                  false],
            ['shifts.create',              'shifts', 'create',              'Create new shifts',                       false],
            ['shifts.edit',                'shifts', 'edit',                'Edit shift details',                      false],
            ['shifts.delete',              'shifts', 'delete',              'Delete shifts',                           false],
            ['shifts.manage_assignments',  'shifts', 'manage_assignments',  'Assign and unassign users to shifts',    false],
            ['shifts.manage_swaps',        'shifts', 'manage_swaps',        'Approve or reject shift swap requests',  false],

            // --- team (4) ---
            ['team.view_members', 'team', 'view_members', 'View org member list',          false],
            ['team.invite',       'team', 'invite',       'Invite new members',             false],
            ['team.remove',       'team', 'remove',       'Remove members from org',        false],
            ['team.change_role',  'team', 'change_role',  'Change a member role',           false],

            // --- settings (4) ---
            ['settings.view_org',       'settings', 'view_org',       'View organization settings',          false],
            ['settings.edit_org',       'settings', 'edit_org',       'Edit org name, timezone, logo',       false],
            ['settings.edit_tracking',  'settings', 'edit_tracking',  'Edit screenshot interval, idle thresholds', false],
            ['settings.manage_billing', 'settings', 'manage_billing', 'View and edit billing, subscription', false],

            // --- audit_logs (1) ---
            ['audit_logs.view', 'audit_logs', 'view', 'View audit logs', false],

            // --- roles (4) ---
            ['roles.view',   'roles', 'view',   'View roles and their permissions', false],
            ['roles.create', 'roles', 'create', 'Create custom roles',             false],
            ['roles.edit',   'roles', 'edit',   'Edit role permissions',            false],
            ['roles.delete', 'roles', 'delete', 'Delete custom roles',             false],
        ];
    }

    /**
     * Default permission matrix per role.
     * Owner gets NO rows (bypass in code).
     * Format: 'permission.key' => scope
     * For has_scope=false permissions, scope is 'none'.
     */
    public function getAdminPermissions(): array
    {
        return [
            // time_entries — all at organization scope
            'time_entries.view'   => 'organization',
            'time_entries.create' => 'organization',
            'time_entries.edit'   => 'organization',
            'time_entries.delete' => 'organization',
            'time_entries.approve'=> 'organization',
            'time_entries.export' => 'organization',

            // screenshots
            'screenshots.view'            => 'organization',
            'screenshots.delete'          => 'organization',
            'screenshots.manage_settings' => 'none',

            // projects
            'projects.view'           => 'organization',
            'projects.create'         => 'none',
            'projects.edit'           => 'organization',
            'projects.delete'         => 'organization',
            'projects.manage_members' => 'organization',

            // reports
            'reports.view'   => 'organization',
            'reports.export' => 'organization',

            // dashboard
            'dashboard.view_own_stats'  => 'none',
            'dashboard.view_team_stats' => 'none',

            // departments
            'departments.view'   => 'none',
            'departments.create' => 'none',
            'departments.edit'   => 'none',
            'departments.delete' => 'none',

            // positions
            'positions.view'        => 'none',
            'positions.create'      => 'none',
            'positions.edit'        => 'none',
            'positions.delete'      => 'none',
            'positions.view_salary' => 'none',

            // employees
            'employees.view_directory'   => 'none',
            'employees.view_profile'     => 'organization',
            'employees.edit_profile'     => 'organization',
            'employees.view_financial'   => 'organization',
            'employees.manage_documents' => 'organization',
            'employees.manage_notes'     => 'organization',

            // leave
            'leave.apply'           => 'none',
            'leave.view_requests'   => 'organization',
            'leave.approve'         => 'organization',
            'leave.cancel'          => 'organization',
            'leave.view_calendar'   => 'organization',
            'leave.manage_types'    => 'none',
            'leave.manage_balances' => 'none',
            'leave.manage_holidays' => 'none',

            // attendance
            'attendance.view'                    => 'organization',
            'attendance.generate'                => 'none',
            'attendance.regularize'              => 'none',
            'attendance.approve_regularizations' => 'organization',
            'attendance.manage_overtime_rules'   => 'none',

            // payroll — admin gets full access
            'payroll.view_own'          => 'none',
            'payroll.view_team'         => 'none',
            'payroll.view_all'          => 'none',
            'payroll.run'               => 'none',
            'payroll.manage_structures' => 'none',
            'payroll.manage_components' => 'none',
            'payroll.approve'           => 'none',

            // shifts
            'shifts.view'               => 'none',
            'shifts.create'             => 'none',
            'shifts.edit'               => 'none',
            'shifts.delete'             => 'none',
            'shifts.manage_assignments' => 'none',
            'shifts.manage_swaps'       => 'none',

            // team
            'team.view_members' => 'none',
            'team.invite'       => 'none',
            'team.remove'       => 'none',
            'team.change_role'  => 'none',

            // settings
            'settings.view_org'       => 'none',
            'settings.edit_org'       => 'none',
            'settings.edit_tracking'  => 'none',
            'settings.manage_billing' => 'none',

            // audit_logs
            'audit_logs.view' => 'none',

            // roles — admin can only view, not create/edit/delete
            'roles.view' => 'none',
        ];
    }

    public function getManagerPermissions(): array
    {
        return [
            // time_entries — team scope
            'time_entries.view'   => 'team',
            'time_entries.create' => 'team',
            'time_entries.edit'   => 'team',
            'time_entries.delete' => 'team',
            'time_entries.approve'=> 'team',
            'time_entries.export' => 'team',

            // screenshots — team view only
            'screenshots.view' => 'team',

            // projects
            'projects.view'           => 'organization',
            'projects.edit'           => 'own',
            'projects.manage_members' => 'own',

            // reports — team
            'reports.view'   => 'team',
            'reports.export' => 'team',

            // dashboard
            'dashboard.view_own_stats'  => 'none',
            'dashboard.view_team_stats' => 'none',

            // departments & positions — view only
            'departments.view' => 'none',
            'positions.view'   => 'none',

            // employees
            'employees.view_directory'   => 'none',
            'employees.view_profile'     => 'team',
            'employees.manage_documents' => 'team',
            // employees.manage_notes: admin/owner only — not granted to manager

            // leave
            'leave.apply'         => 'none',
            'leave.view_requests' => 'organization',
            'leave.approve'       => 'organization',
            'leave.cancel'        => 'organization',
            'leave.view_calendar' => 'organization',

            // attendance
            'attendance.view'                    => 'organization',
            'attendance.regularize'              => 'none',
            'attendance.approve_regularizations' => 'organization',

            // payroll — manager: view own + view team
            'payroll.view_own'  => 'none',
            'payroll.view_team' => 'none',

            // shifts — view, manage assignments, manage swaps
            'shifts.view'               => 'none',
            'shifts.manage_assignments' => 'none',
            'shifts.manage_swaps'       => 'none',

            // team — view + invite
            'team.view_members' => 'none',
            'team.invite'       => 'none',
        ];
    }

    public function getEmployeePermissions(): array
    {
        return [
            // time_entries — own scope, no approve
            'time_entries.view'   => 'own',
            'time_entries.create' => 'own',
            'time_entries.edit'   => 'own',
            'time_entries.delete' => 'own',
            'time_entries.export' => 'own',

            // screenshots — own view only
            'screenshots.view' => 'own',

            // projects — own (assigned) view only
            'projects.view' => 'own',

            // reports — own
            'reports.view'   => 'own',
            'reports.export' => 'own',

            // dashboard — own stats only
            'dashboard.view_own_stats' => 'none',

            // departments & positions — view only
            'departments.view' => 'none',
            'positions.view'   => 'none',

            // employees — own profile
            'employees.view_directory'   => 'none',
            'employees.view_profile'     => 'own',
            'employees.edit_profile'     => 'own',
            'employees.view_financial'   => 'own',
            'employees.manage_documents' => 'own',

            // leave — own requests, team calendar
            'leave.apply'         => 'none',
            'leave.view_requests' => 'own',
            'leave.cancel'        => 'own',
            'leave.view_calendar' => 'team',

            // attendance — own view, can regularize
            'attendance.view'       => 'own',
            'attendance.regularize' => 'none',

            // payroll — employee: view own payslips only
            'payroll.view_own' => 'none',

            // shifts — view only
            'shifts.view' => 'none',
        ];
    }

    public function run(): void
    {
        DB::transaction(function () {
            // ---------------------------------------------------------
            // Step 1: Clear and re-seed permissions
            // ---------------------------------------------------------
            // Delete role_permissions first (FK dependency), then permissions
            DB::table('role_permissions')->delete();
            DB::table('permissions')->delete();

            $permissionMap = []; // key => id
            $now = now();

            foreach ($this->getPermissions() as [$key, $module, $action, $description, $hasScope]) {
                $id = Str::uuid()->toString();
                DB::table('permissions')->insert([
                    'id'          => $id,
                    'key'         => $key,
                    'module'      => $module,
                    'action'      => $action,
                    'description' => $description,
                    'has_scope'   => $hasScope,
                ]);
                $permissionMap[$key] = $id;
            }

            // ---------------------------------------------------------
            // Step 2: For each organization, create system roles + assign permissions
            // ---------------------------------------------------------
            $organizations = DB::table('organizations')->select('id')->get();

            $roleDefinitions = [
                ['name' => 'owner',    'display_name' => 'Owner',    'priority' => 100, 'is_default' => false],
                ['name' => 'admin',    'display_name' => 'Admin',    'priority' => 75,  'is_default' => false],
                ['name' => 'manager',  'display_name' => 'Manager',  'priority' => 50,  'is_default' => false],
                ['name' => 'employee', 'display_name' => 'Employee', 'priority' => 10,  'is_default' => true],
            ];

            $adminPerms    = $this->getAdminPermissions();
            $managerPerms  = $this->getManagerPermissions();
            $employeePerms = $this->getEmployeePermissions();

            foreach ($organizations as $org) {
                $orgRoleIds = [];

                // Delete existing system roles for this org (idempotent re-run)
                DB::table('roles')
                    ->where('organization_id', $org->id)
                    ->where('is_system', true)
                    ->delete();

                // Create 4 system roles
                foreach ($roleDefinitions as $def) {
                    $roleId = Str::uuid()->toString();
                    DB::table('roles')->insert([
                        'id'              => $roleId,
                        'organization_id' => $org->id,
                        'name'            => $def['name'],
                        'display_name'    => $def['display_name'],
                        'is_system'       => true,
                        'is_default'      => $def['is_default'],
                        'priority'        => $def['priority'],
                        'created_at'      => $now,
                        'updated_at'      => $now,
                    ]);
                    $orgRoleIds[$def['name']] = $roleId;
                }

                // Owner: NO role_permissions rows (bypass in code)

                // Admin permissions
                $this->insertRolePermissions($orgRoleIds['admin'], $adminPerms, $permissionMap);

                // Manager permissions
                $this->insertRolePermissions($orgRoleIds['manager'], $managerPerms, $permissionMap);

                // Employee permissions
                $this->insertRolePermissions($orgRoleIds['employee'], $employeePerms, $permissionMap);
            }
        });
    }

    /**
     * Bulk-insert role_permissions rows for a single role.
     */
    private function insertRolePermissions(string $roleId, array $permScopes, array $permissionMap): void
    {
        $rows = [];
        $now = now();

        foreach ($permScopes as $key => $scope) {
            if (! isset($permissionMap[$key])) {
                continue; // Safety: skip if permission key not found
            }

            $rows[] = [
                'id'            => Str::uuid()->toString(),
                'role_id'       => $roleId,
                'permission_id' => $permissionMap[$key],
                'scope'         => $scope,
                'created_at'    => $now,
            ];
        }

        // Insert in chunks to avoid exceeding parameter limits
        foreach (array_chunk($rows, 50) as $chunk) {
            DB::table('role_permissions')->insert($chunk);
        }
    }
}
