<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\Team;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Create demo organization
        $org = Organization::create([
            'name' => 'Acme Corp',
            'slug' => 'acme-corp',
            'plan' => 'pro',
            'trial_ends_at' => now()->addDays(14),
            'settings' => [
                'screenshot_interval' => 5,
                'blur_screenshots' => false,
                'idle_timeout' => 5,
                'timezone' => 'America/New_York',
                'can_add_manual_time' => true,
            ],
        ]);

        // Create owner
        $owner = User::create([
            'organization_id' => $org->id,
            'name' => 'John Owner',
            'email' => 'owner@acme.com',
            'password' => Hash::make('password'),
            'role' => 'owner',
            'timezone' => 'America/New_York',
            'is_active' => true,
        ]);

        // Create admin
        $admin = User::create([
            'organization_id' => $org->id,
            'name' => 'Sarah Admin',
            'email' => 'admin@acme.com',
            'password' => Hash::make('password'),
            'role' => 'admin',
            'timezone' => 'America/New_York',
            'is_active' => true,
        ]);

        // Create manager
        $manager = User::create([
            'organization_id' => $org->id,
            'name' => 'Mike Manager',
            'email' => 'manager@acme.com',
            'password' => Hash::make('password'),
            'role' => 'manager',
            'timezone' => 'America/Chicago',
            'is_active' => true,
        ]);

        // Create employees
        $employees = [];
        $employeeData = [
            ['name' => 'Alice Developer', 'email' => 'alice@acme.com', 'timezone' => 'America/New_York'],
            ['name' => 'Bob Designer', 'email' => 'bob@acme.com', 'timezone' => 'America/Los_Angeles'],
            ['name' => 'Carol QA', 'email' => 'carol@acme.com', 'timezone' => 'Europe/London'],
            ['name' => 'Dave Backend', 'email' => 'dave@acme.com', 'timezone' => 'Asia/Kolkata'],
        ];

        foreach ($employeeData as $data) {
            $employees[] = User::create([
                'organization_id' => $org->id,
                'name' => $data['name'],
                'email' => $data['email'],
                'password' => Hash::make('password'),
                'role' => 'employee',
                'timezone' => $data['timezone'],
                'is_active' => true,
            ]);
        }

        // Create teams
        $engineering = Team::create([
            'organization_id' => $org->id,
            'name' => 'Engineering',
            'manager_id' => $manager->id,
        ]);

        $design = Team::create([
            'organization_id' => $org->id,
            'name' => 'Design',
            'manager_id' => $manager->id,
        ]);

        // Attach members to teams
        $engineering->members()->attach([$employees[0]->id, $employees[2]->id, $employees[3]->id]);
        $design->members()->attach([$employees[1]->id]);

        // Create projects
        $webApp = Project::create([
            'organization_id' => $org->id,
            'name' => 'Web Application',
            'color' => '#3B82F6',
            'billable' => true,
            'hourly_rate' => 150.00,
            'created_by' => $owner->id,
        ]);

        $mobileApp = Project::create([
            'organization_id' => $org->id,
            'name' => 'Mobile App',
            'color' => '#8B5CF6',
            'billable' => true,
            'hourly_rate' => 125.00,
            'created_by' => $owner->id,
        ]);

        $internal = Project::create([
            'organization_id' => $org->id,
            'name' => 'Internal Tools',
            'color' => '#10B981',
            'billable' => false,
            'created_by' => $admin->id,
        ]);

        // Create tasks for projects
        $tasks = [];
        $webTasks = [
            ['name' => 'User Authentication', 'project_id' => $webApp->id],
            ['name' => 'Dashboard UI', 'project_id' => $webApp->id],
            ['name' => 'API Integration', 'project_id' => $webApp->id],
            ['name' => 'Performance Optimization', 'project_id' => $webApp->id],
        ];

        foreach ($webTasks as $taskData) {
            $tasks[] = Task::create([
                'organization_id' => $org->id,
                'project_id' => $taskData['project_id'],
                'name' => $taskData['name'],
                'created_by' => $owner->id,
            ]);
        }

        $mobileTasks = [
            ['name' => 'Push Notifications', 'project_id' => $mobileApp->id],
            ['name' => 'Offline Mode', 'project_id' => $mobileApp->id],
        ];

        foreach ($mobileTasks as $taskData) {
            $tasks[] = Task::create([
                'organization_id' => $org->id,
                'project_id' => $taskData['project_id'],
                'name' => $taskData['name'],
                'created_by' => $owner->id,
            ]);
        }

        $internalTasks = [
            ['name' => 'CI/CD Pipeline', 'project_id' => $internal->id],
            ['name' => 'Documentation', 'project_id' => $internal->id],
        ];

        foreach ($internalTasks as $taskData) {
            $tasks[] = Task::create([
                'organization_id' => $org->id,
                'project_id' => $taskData['project_id'],
                'name' => $taskData['name'],
                'created_by' => $admin->id,
            ]);
        }

        // Create time entries for the past 7 days
        $allUsers = array_merge([$owner, $admin, $manager], $employees);
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
                    if ($endedAt->hour >= 20) break;

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
                    if ($currentHour >= 20) break;
                }
            }
        }

        $this->command->info('✓ Demo data seeded successfully!');
        $this->command->info('');
        $this->command->info('  Login credentials (password: "password" for all):');
        $this->command->info('  Owner:    owner@acme.com');
        $this->command->info('  Admin:    admin@acme.com');
        $this->command->info('  Manager:  manager@acme.com');
        $this->command->info('  Employee: alice@acme.com');
    }
}
