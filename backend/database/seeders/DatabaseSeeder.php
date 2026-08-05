<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\Project;
use App\Models\Role;
use App\Models\Task;
use App\Models\Team;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * One demo account per system role in the RBAC matrix.
     *
     * The `role` value MUST be a system role name created by PermissionSeeder
     * (owner / org_manager / hr_manager / finance_manager / employee).
     *
     * It used to be 'admin' and 'manager' — names the 2026_05_13_000004 migration
     * retired. On a fresh `migrate --seed` that migration runs against an EMPTY users
     * table, so it renamed nothing and the seeder then re-introduced the dead names.
     * PermissionService::buildPermissionMap() resolves permissions by matching this
     * string against a system role, so those two accounts got an EMPTY permission map:
     * they authenticated and then saw a dashboard with nothing on it.
     */
    private const DEMO_USERS = [
        ['name' => 'John Owner',      'email' => 'owner@acme.com',   'role' => 'owner',           'timezone' => 'Asia/Karachi'],
        ['name' => 'Mike Manager',    'email' => 'manager@acme.com', 'role' => 'org_manager',     'timezone' => 'America/Chicago'],
        ['name' => 'Hina HR',         'email' => 'hr@acme.com',      'role' => 'hr_manager',      'timezone' => 'Asia/Karachi'],
        ['name' => 'Fiona Finance',   'email' => 'finance@acme.com', 'role' => 'finance_manager', 'timezone' => 'Asia/Karachi'],
        ['name' => 'Alice Developer', 'email' => 'alice@acme.com',   'role' => 'employee',        'timezone' => 'Asia/Karachi'],
        ['name' => 'Bob Designer',    'email' => 'bob@acme.com',     'role' => 'employee',        'timezone' => 'America/Los_Angeles'],
        ['name' => 'Carol QA',        'email' => 'carol@acme.com',   'role' => 'employee',        'timezone' => 'Europe/London'],
        ['name' => 'Dave Backend',    'email' => 'dave@acme.com',    'role' => 'employee',        'timezone' => 'Asia/Kolkata'],
    ];

    /**
     * Seed the application's database.
     *
     * Re-runnable: every step is keyed on a natural identifier, so running
     * `php artisan db:seed` against an already-seeded database repairs the demo
     * accounts (including a wrong `role` string) instead of failing on a unique
     * constraint or duplicating the sample time entries.
     */
    public function run(): void
    {
        // Create demo organization
        $org = Organization::firstOrCreate(
            ['slug' => 'acme-corp'],
            [
                'name' => 'Acme Corp',
                'plan' => 'pro',
                'trial_ends_at' => now()->addDays(14),
                'settings' => [
                    'screenshot_interval' => 5,
                    'blur_screenshots' => false,
                    'idle_timeout' => 10,
                    'timezone' => 'Asia/Karachi',
                    'can_add_manual_time' => true,
                ],
            ]
        );

        // Create one user per role. Keyed by email so the rest of the seeder can
        // pick users out by hand, and so a re-run updates rather than duplicates.
        // The match is on (email, organization_id): the same email may legitimately
        // exist in another organization under multi-org auth.
        $users = [];
        foreach (self::DEMO_USERS as $data) {
            $users[$data['email']] = User::updateOrCreate(
                [
                    'email' => $data['email'],
                    'organization_id' => $org->id,
                ],
                [
                    'name' => $data['name'],
                    'password' => Hash::make('password'),
                    'role' => $data['role'],
                    'timezone' => $data['timezone'],
                    'is_active' => true,
                ]
            );
        }

        $owner = $users['owner@acme.com'];
        $manager = $users['manager@acme.com'];
        $hr = $users['hr@acme.com'];
        $finance = $users['finance@acme.com'];

        $employees = [
            $users['alice@acme.com'],
            $users['bob@acme.com'],
            $users['carol@acme.com'],
            $users['dave@acme.com'],
        ];

        // Staff = everyone who is not a plain employee. Used for internal projects
        // and for the accounts that get sample tracked time.
        $staff = [$owner, $manager, $hr, $finance];

        // Create teams
        $engineering = Team::firstOrCreate(
            ['organization_id' => $org->id, 'name' => 'Engineering'],
            ['manager_id' => $manager->id]
        );

        $design = Team::firstOrCreate(
            ['organization_id' => $org->id, 'name' => 'Design'],
            ['manager_id' => $manager->id]
        );

        // Attach members to teams
        $engineering->members()->syncWithoutDetaching([$employees[0]->id, $employees[2]->id, $employees[3]->id]);
        $design->members()->syncWithoutDetaching([$employees[1]->id]);

        // Create projects
        $webApp = Project::firstOrCreate(
            ['organization_id' => $org->id, 'name' => 'Web Application'],
            [
                'color' => '#3B82F6',
                'billable' => true,
                'hourly_rate' => 150.00,
                'created_by' => $owner->id,
            ]
        );

        $mobileApp = Project::firstOrCreate(
            ['organization_id' => $org->id, 'name' => 'Mobile App'],
            [
                'color' => '#8B5CF6',
                'billable' => true,
                'hourly_rate' => 125.00,
                'created_by' => $owner->id,
            ]
        );

        $internal = Project::firstOrCreate(
            ['organization_id' => $org->id, 'name' => 'Internal Tools'],
            [
                'color' => '#10B981',
                'billable' => false,
                'created_by' => $manager->id,
            ]
        );

        // Assign members to projects.
        // Without this the `project_user` pivot stays empty, and an employee signing
        // in to the desktop agent gets an EMPTY project dropdown — which disables the
        // Start button outright, so a freshly seeded database cannot track any time.
        // Everyone gets the two client projects; Internal Tools goes to staff only.
        $staffIds = collect($staff)->pluck('id')->all();

        $webApp->members()->syncWithoutDetaching(
            collect($employees)->pluck('id')->merge($staffIds)->all()
        );
        $mobileApp->members()->syncWithoutDetaching(
            collect($employees)->pluck('id')->merge($staffIds)->all()
        );
        $internal->members()->syncWithoutDetaching($staffIds);

        // Create tasks for projects
        $taskData = [
            ['name' => 'User Authentication', 'project' => $webApp, 'created_by' => $owner],
            ['name' => 'Dashboard UI', 'project' => $webApp, 'created_by' => $owner],
            ['name' => 'API Integration', 'project' => $webApp, 'created_by' => $owner],
            ['name' => 'Performance Optimization', 'project' => $webApp, 'created_by' => $owner],
            ['name' => 'Push Notifications', 'project' => $mobileApp, 'created_by' => $owner],
            ['name' => 'Offline Mode', 'project' => $mobileApp, 'created_by' => $owner],
            ['name' => 'CI/CD Pipeline', 'project' => $internal, 'created_by' => $manager],
            ['name' => 'Documentation', 'project' => $internal, 'created_by' => $manager],
        ];

        foreach ($taskData as $data) {
            Task::firstOrCreate(
                [
                    'organization_id' => $org->id,
                    'project_id' => $data['project']->id,
                    'name' => $data['name'],
                ],
                ['created_by' => $data['created_by']->id]
            );
        }

        // Create time entries for the past 7 days. Skipped entirely on a re-run so
        // repairing the demo accounts doesn't pile another week of hours onto the
        // dashboards every time someone runs `db:seed`.
        $allUsers = array_merge($staff, $employees);

        if (TimeEntry::where('organization_id', $org->id)->doesntExist()) {
            $allProjects = [$webApp, $mobileApp, $internal];

            foreach ($allUsers as $user) {
                for ($daysAgo = 0; $daysAgo < 7; $daysAgo++) {
                    $date = now()->subDays($daysAgo);
                    $entriesPerDay = rand(2, 5);

                    $currentHour = 9; // Start at 9 AM
                    for ($j = 0; $j < $entriesPerDay; $j++) {
                        $project = $allProjects[array_rand($allProjects)];
                        $duration = rand(30, 180) * 60; // 30 min to 3 hours in seconds
                        $startedAt = $date->copy()->setTime($currentHour, rand(0, 59));
                        $endedAt = $startedAt->copy()->addSeconds($duration);

                        // Don't go past midnight
                        if ($endedAt->hour >= 20) {
                            break;
                        }

                        TimeEntry::create([
                            'organization_id' => $org->id,
                            'user_id' => $user->id,
                            'project_id' => $project->id,
                            'task_id' => null,
                            'notes' => null,
                            'started_at' => $startedAt,
                            'ended_at' => $endedAt,
                            'duration_seconds' => $duration,
                            'type' => 'tracked',
                            'is_approved' => $daysAgo > 1 ? true : false,
                            'activity_score' => rand(40, 100),
                        ]);

                        $currentHour = $endedAt->hour + 1;
                        if ($currentHour >= 20) {
                            break;
                        }
                    }
                }
            }
        }

        // Full RBAC catalog (63+ permissions) + system roles per org. Migrations only
        // insert payroll/shifts/check-in permissions incrementally; without this,
        // Owner's bypass (Permission::all()) exposes only those partial rows.
        $this->call(PermissionSeeder::class);

        // MUST run after PermissionSeeder: it deletes and recreates the org's system
        // roles on every run, and `user_roles.role_id` is ON DELETE CASCADE, so any
        // assignment made before that call is wiped by it.
        $this->assignSystemRoles($org->id, $users);

        $this->command->info('✓ Demo data seeded successfully!');
        $this->command->info('');
        $this->command->info('  Login credentials (password: "password" for all):');
        $this->command->info('  Super Admin (owner):  owner@acme.com');
        $this->command->info('  Manager:              manager@acme.com');
        $this->command->info('  HR:                   hr@acme.com');
        $this->command->info('  Finance Manager:      finance@acme.com');
        $this->command->info('  Employee:             alice@acme.com');
    }

    /**
     * Link each demo user to their organization's system role via `user_roles`.
     *
     * PermissionService reads `user_roles` first and only falls back to the
     * `users.role` string when a user has no rows there. Seeding the pivot means the
     * demo data exercises the same path production accounts take, rather than living
     * permanently on the backward-compatibility fallback.
     *
     * @param  array<string, User>  $users  keyed by email
     */
    private function assignSystemRoles(string $orgId, array $users): void
    {
        $roleIds = Role::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('is_system', true)
            ->pluck('id', 'name');

        $now = now();
        $rows = [];

        foreach (self::DEMO_USERS as $data) {
            $user = $users[$data['email']] ?? null;
            $roleId = $roleIds[$data['role']] ?? null;

            if (! $user || ! $roleId) {
                $this->command->warn("  ! No system role '{$data['role']}' for {$data['email']} — skipped");

                continue;
            }

            $rows[] = [
                'id' => Str::uuid()->toString(),
                'user_id' => $user->id,
                'role_id' => $roleId,
                'assigned_by' => null,
                'assigned_at' => $now,
            ];
        }

        // Replace rather than upsert, so a user whose demo role CHANGED between runs
        // doesn't keep the stale assignment alongside the new one.
        DB::table('user_roles')
            ->whereIn('user_id', collect($users)->pluck('id')->all())
            ->delete();

        if ($rows !== []) {
            DB::table('user_roles')->insert($rows);
        }
    }
}
