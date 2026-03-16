<?php

namespace Database\Seeders;

use App\Models\Permission;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class PermissionSeeder extends Seeder
{
    public function run(): void
    {
        $permissions = [
            // Timer
            ['name' => 'timer.start', 'group' => 'timer', 'description' => 'Start timer'],
            ['name' => 'timer.stop', 'group' => 'timer', 'description' => 'Stop timer'],
            ['name' => 'timer.view-others', 'group' => 'timer', 'description' => 'View other users active timers'],

            // Time Entries
            ['name' => 'time-entries.create', 'group' => 'time-entries', 'description' => 'Create time entries'],
            ['name' => 'time-entries.read', 'group' => 'time-entries', 'description' => 'View own time entries'],
            ['name' => 'time-entries.read-all', 'group' => 'time-entries', 'description' => 'View all time entries'],
            ['name' => 'time-entries.update', 'group' => 'time-entries', 'description' => 'Update own time entries'],
            ['name' => 'time-entries.update-all', 'group' => 'time-entries', 'description' => 'Update any time entry'],
            ['name' => 'time-entries.delete', 'group' => 'time-entries', 'description' => 'Delete own time entries'],
            ['name' => 'time-entries.delete-all', 'group' => 'time-entries', 'description' => 'Delete any time entry'],
            ['name' => 'time-entries.approve', 'group' => 'time-entries', 'description' => 'Approve time entries'],

            // Projects
            ['name' => 'projects.create', 'group' => 'projects', 'description' => 'Create projects'],
            ['name' => 'projects.read', 'group' => 'projects', 'description' => 'View projects'],
            ['name' => 'projects.update', 'group' => 'projects', 'description' => 'Update projects'],
            ['name' => 'projects.delete', 'group' => 'projects', 'description' => 'Delete projects'],

            // Tasks
            ['name' => 'tasks.create', 'group' => 'tasks', 'description' => 'Create tasks'],
            ['name' => 'tasks.read', 'group' => 'tasks', 'description' => 'View tasks'],
            ['name' => 'tasks.update', 'group' => 'tasks', 'description' => 'Update tasks'],
            ['name' => 'tasks.delete', 'group' => 'tasks', 'description' => 'Delete tasks'],

            // Screenshots
            ['name' => 'screenshots.view', 'group' => 'screenshots', 'description' => 'View own screenshots'],
            ['name' => 'screenshots.view-all', 'group' => 'screenshots', 'description' => 'View all screenshots'],
            ['name' => 'screenshots.upload', 'group' => 'screenshots', 'description' => 'Upload screenshots'],
            ['name' => 'screenshots.delete', 'group' => 'screenshots', 'description' => 'Delete screenshots'],

            // Reports
            ['name' => 'reports.view', 'group' => 'reports', 'description' => 'View reports'],
            ['name' => 'reports.export', 'group' => 'reports', 'description' => 'Export reports'],

            // Team
            ['name' => 'teams.view', 'group' => 'teams', 'description' => 'View teams'],
            ['name' => 'teams.manage', 'group' => 'teams', 'description' => 'Create, update, delete teams'],

            // Users
            ['name' => 'users.view', 'group' => 'users', 'description' => 'View users'],
            ['name' => 'users.create', 'group' => 'users', 'description' => 'Create/invite users'],
            ['name' => 'users.update', 'group' => 'users', 'description' => 'Update users'],
            ['name' => 'users.delete', 'group' => 'users', 'description' => 'Deactivate users'],
            ['name' => 'users.manage-roles', 'group' => 'users', 'description' => 'Change user roles'],

            // Settings
            ['name' => 'settings.view', 'group' => 'settings', 'description' => 'View organization settings'],
            ['name' => 'settings.update', 'group' => 'settings', 'description' => 'Update organization settings'],

            // Billing
            ['name' => 'billing.view', 'group' => 'billing', 'description' => 'View billing info'],
            ['name' => 'billing.manage', 'group' => 'billing', 'description' => 'Manage subscriptions'],

            // Audit
            ['name' => 'audit-logs.view', 'group' => 'audit', 'description' => 'View audit logs'],

            // Timesheets
            ['name' => 'timesheets.submit', 'group' => 'timesheets', 'description' => 'Submit timesheets'],
            ['name' => 'timesheets.review', 'group' => 'timesheets', 'description' => 'Review timesheets'],

            // Invitations
            ['name' => 'invitations.send', 'group' => 'invitations', 'description' => 'Send invitations'],

            // SSO
            ['name' => 'sso.configure', 'group' => 'sso', 'description' => 'Configure SSO settings'],
        ];

        foreach ($permissions as $perm) {
            Permission::firstOrCreate(['name' => $perm['name']], $perm);
        }

        // Role-permission mappings
        $rolePermissions = [
            'employee' => [
                'timer.start', 'timer.stop',
                'time-entries.create', 'time-entries.read', 'time-entries.update', 'time-entries.delete',
                'projects.read', 'tasks.read', 'tasks.create',
                'screenshots.view', 'screenshots.upload',
                'timesheets.submit',
                'settings.view',
            ],
            'manager' => [
                'timer.start', 'timer.stop', 'timer.view-others',
                'time-entries.create', 'time-entries.read', 'time-entries.read-all',
                'time-entries.update', 'time-entries.update-all',
                'time-entries.delete', 'time-entries.approve',
                'projects.create', 'projects.read', 'projects.update',
                'tasks.create', 'tasks.read', 'tasks.update', 'tasks.delete',
                'screenshots.view', 'screenshots.view-all', 'screenshots.upload', 'screenshots.delete',
                'reports.view', 'reports.export',
                'teams.view', 'teams.manage',
                'users.view',
                'timesheets.submit', 'timesheets.review',
                'settings.view',
            ],
            'admin' => [
                'timer.start', 'timer.stop', 'timer.view-others',
                'time-entries.create', 'time-entries.read', 'time-entries.read-all',
                'time-entries.update', 'time-entries.update-all',
                'time-entries.delete', 'time-entries.delete-all', 'time-entries.approve',
                'projects.create', 'projects.read', 'projects.update', 'projects.delete',
                'tasks.create', 'tasks.read', 'tasks.update', 'tasks.delete',
                'screenshots.view', 'screenshots.view-all', 'screenshots.upload', 'screenshots.delete',
                'reports.view', 'reports.export',
                'teams.view', 'teams.manage',
                'users.view', 'users.create', 'users.update', 'users.delete', 'users.manage-roles',
                'settings.view', 'settings.update',
                'billing.view', 'billing.manage',
                'audit-logs.view',
                'timesheets.submit', 'timesheets.review',
                'invitations.send',
            ],
            'owner' => [], // Owner bypasses all checks
        ];

        foreach ($rolePermissions as $role => $permNames) {
            foreach ($permNames as $permName) {
                $permission = Permission::where('name', $permName)->first();
                if ($permission) {
                    DB::table('role_permissions')->insertOrIgnore([
                        'role' => $role,
                        'permission_id' => $permission->id,
                    ]);
                }
            }
        }
    }
}
