<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Organization extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'name',
        'slug',
        'plan',
        'stripe_customer_id',
        'stripe_subscription_id',
        'trial_ends_at',
        'settings',
        'sso_config',
        'enforce_sso',
        'data_retention_config',
    ];

    protected function casts(): array
    {
        return [
            'settings' => 'array',
            'sso_config' => 'array',
            'data_retention_config' => 'array',
            'enforce_sso' => 'boolean',
            'trial_ends_at' => 'datetime',
        ];
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function teams(): HasMany
    {
        return $this->hasMany(Team::class);
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(Invitation::class);
    }

    public function timeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class);
    }

    public function screenshots(): HasMany
    {
        return $this->hasMany(Screenshot::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(Shift::class);
    }

    public function timesheets(): HasMany
    {
        return $this->hasMany(Timesheet::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    public function apiKeys(): HasMany
    {
        return $this->hasMany(ApiKey::class);
    }

    public function getDefaultSettings(): array
    {
        return [
            'screenshot_interval' => 5,
            'blur_screenshots' => false,
            'idle_timeout' => 5,
            // Idle alert emails are org-configurable and disabled by default to prevent spam.
            'idle_alert_email_enabled' => false,
            // Cooldown (minutes) between repeated idle alert emails for the same employee.
            'idle_alert_email_cooldown_min' => 60,
            // Idle handling behavior: prompt | always | never
            // Production default: prompt user to keep/discard idle time (Hubstaff-like).
            'keep_idle_time' => 'prompt',
            'timezone' => 'America/New_York',
            'can_add_manual_time' => true,
            'employees_see_all_projects' => false, // if false, employees see only projects they are assigned to
            // Idle alert auto-stop (only relevant in "prompt" mode).
            'idle_alert_auto_stop_min' => 10,
            // After user resolves idle alert (or auto-discard), capture one screenshot immediately.
            'screenshot_capture_immediate_after_idle' => true,
            // Delay (minutes) before first screenshot when timer starts. 0 = immediate.
            'screenshot_first_capture_delay_min' => 1,
            // How often (seconds) desktop checks OS idle time.
            'idle_check_interval_sec' => 10,
            // Only capture screenshots when app window is visible (reduces permission prompts when hidden).
            'capture_only_when_visible' => false,
            // Capture all monitors and composite into one image.
            'capture_multi_monitor' => false,
            'weekly_hours_target' => 0, // 0 = disabled, >0 = minimum hours per week (Mon-Sun)
        ];
    }

    public function getSetting(string $key, mixed $default = null): mixed
    {
        $settings = $this->settings ?? [];
        return $settings[$key] ?? $this->getDefaultSettings()[$key] ?? $default;
    }
}
