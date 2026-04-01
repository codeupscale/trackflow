<?php

namespace App\Models;

use App\Services\PermissionService;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasUuids, Notifiable, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'name',
        'email',
        'password',
        'role',
        'timezone',
        'avatar_url',
        'job_title',
        'phone',
        'linkedin_url',
        'github_url',
        'date_of_birth',
        'date_of_joining',
        'bio',
        'is_active',
        'last_active_at',
        'settings',
        'email_verified_at',
        'sso_provider',
        'sso_provider_id',
        'consent_given_at',
        'privacy_policy_version',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_active_at' => 'datetime',
            'consent_given_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
            'settings' => 'array',
            'date_of_birth' => 'date',
            'date_of_joining' => 'date',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function timeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class);
    }

    public function screenshots(): HasMany
    {
        return $this->hasMany(Screenshot::class);
    }

    public function teams(): BelongsToMany
    {
        return $this->belongsToMany(Team::class, 'team_user');
    }

    public function managedTeams(): HasMany
    {
        return $this->hasMany(Team::class, 'manager_id');
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

    /**
     * Projects this user is assigned to. Employees see only these projects
     * (unless organization setting employees_see_all_projects is true).
     */
    public function assignedProjects(): BelongsToMany
    {
        return $this->belongsToMany(Project::class, 'project_user')->withTimestamps();
    }

    public function approvedTimeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class, 'approved_by');
    }

    public function reviewedTimesheets(): HasMany
    {
        return $this->hasMany(Timesheet::class, 'reviewed_by');
    }

    public function shifts(): BelongsToMany
    {
        return $this->belongsToMany(Shift::class, 'user_shifts')
            ->withPivot(['effective_from', 'effective_to']);
    }

    /**
     * Roles assigned to this user via the user_roles pivot table.
     */
    public function assignedRoles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'user_roles')
            ->withPivot('assigned_at');
    }

    /**
     * Derive the role string from user_roles if available, otherwise fall back
     * to the raw database column for backward compatibility.
     */
    public function getRoleAttribute($value): string
    {
        if ($this->relationLoaded('assignedRoles') && $this->assignedRoles->isNotEmpty()) {
            return $this->assignedRoles->sortByDesc('priority')->first()->name;
        }

        return $value ?? 'employee';
    }

    /**
     * Get the user's primary (highest-priority) role model.
     */
    public function primaryRole(): ?Role
    {
        return $this->assignedRoles()->orderByDesc('roles.priority')->first();
    }

    /**
     * Get the full permission map for this user.
     * Returns ['permission.key' => 'scope', ...].
     */
    public function getPermissionMap(): array
    {
        return app(PermissionService::class)->getPermissionMap($this);
    }

    public function isOwner(): bool
    {
        return $this->role === 'owner';
    }

    public function isAdmin(): bool
    {
        return $this->role === 'admin';
    }

    public function isManager(): bool
    {
        return $this->role === 'manager';
    }

    public function isEmployee(): bool
    {
        return $this->role === 'employee';
    }

    public function hasRole(string ...$roles): bool
    {
        return in_array($this->role, $roles);
    }

    /**
     * Timezone for date filters and "today" (user → organization default → app).
     * Used so all date ranges and "today" are in the user's local time.
     */
    public function getTimezoneForDates(): string
    {
        if (! empty($this->timezone)) {
            return $this->timezone;
        }

        $org = $this->relationLoaded('organization') ? $this->organization : $this->organization()->first();
        if ($org !== null) {
            $setting = $org->getSetting('timezone');
            if ($setting !== null && $setting !== '') {
                return $setting;
            }
        }

        return config('app.timezone', 'UTC');
    }

    /**
     * Check if the user has a specific permission, optionally at a required scope level.
     */
    public function hasPermission(string $permission, ?string $scope = null): bool
    {
        if ($this->isOwner()) {
            return true;
        }

        return app(PermissionService::class)->hasPermission($this, $permission, $scope);
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class);
    }

    public function employeeProfile(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(EmployeeProfile::class);
    }

    public function employeeDocuments(): HasMany
    {
        return $this->hasMany(EmployeeDocument::class);
    }

    public function employeeNotes(): HasMany
    {
        return $this->hasMany(EmployeeNote::class);
    }
}
