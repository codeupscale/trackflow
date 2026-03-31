<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Project extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids;

    protected $fillable = [
        'organization_id',
        'name',
        'color',
        'billable',
        'hourly_rate',
        'is_archived',
        'created_by',
        'manager_id',
    ];

    protected $appends = ['total_hours'];

    protected function casts(): array
    {
        return [
            'billable' => 'boolean',
            'is_archived' => 'boolean',
            'hourly_rate' => 'decimal:2',
        ];
    }

    /**
     * Total tracked hours for this project (derived from aggregated duration_seconds).
     * Requires withSum('timeEntries as total_duration_seconds', 'duration_seconds') on the query.
     */
    public function getTotalHoursAttribute(): float
    {
        return round(($this->total_duration_seconds ?? 0) / 3600, 1);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_id');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function timeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class);
    }

    /**
     * Team members assigned to this project (for time tracking visibility and access).
     * Owner/Admin/Manager see all projects; employees see only projects they are assigned to
     * (unless organization setting employees_see_all_projects is true).
     */
    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'project_user')->withTimestamps();
    }

    public function isAssignedTo(User $user): bool
    {
        if ($user->hasRole('owner', 'admin', 'manager')) {
            return true;
        }
        $org = $user->relationLoaded('organization') ? $user->organization : $user->organization()->first();
        if ($org && $org->getSetting('employees_see_all_projects', false)) {
            return true;
        }
        return $this->members()->where('user_id', $user->id)->exists();
    }
}
