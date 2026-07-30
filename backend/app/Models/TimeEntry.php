<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class TimeEntry extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'user_id',
        'project_id',
        'task_id',
        'started_at',
        'ended_at',
        'duration_seconds',
        'type',
        'activity_score',
        'notes',
        'idempotency_key',
        'client_revision',
        'client_synced_at',
        'is_approved',
        'approved_by',
        'approved_at',
        'approval_status',
        'submitted_by',
        'rejection_reason',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'approved_at' => 'datetime',
            'client_synced_at' => 'datetime',
            'client_revision' => 'integer',
            'is_approved' => 'boolean',
            'activity_score' => 'integer',
            'duration_seconds' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /**
     * Who created this (manual) entry. May differ from user_id when an
     * authorised user logs time on another employee's behalf.
     */
    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by');
    }

    /**
     * Only entries that count toward reports/aggregates.
     *
     * approval_status is the authoritative state and defaults to 'approved' —
     * tracked/idle entries and every historical row are 'approved', so this
     * scope is a no-op for them. is_approved is kept in sync with
     * (approval_status === 'approved') by the write paths for backward
     * compatibility with older consumers still reading the boolean.
     */
    public function scopeApproved($query)
    {
        return $query->where('approval_status', 'approved');
    }

    /**
     * Only entries awaiting a manager decision (manual entries submitted by an
     * employee whose approve scope does not cover themselves).
     */
    public function scopePending($query)
    {
        return $query->where('approval_status', 'pending');
    }

    public function screenshots(): HasMany
    {
        return $this->hasMany(Screenshot::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    public function isRunning(): bool
    {
        return is_null($this->ended_at);
    }

    /**
     * Backward-compatible accessor: allows $entry['entry'] to return $this.
     * This supports code that previously consumed the array format
     * ['entry' => TimeEntry, 'is_existing' => bool] returned by TimerService::start().
     */
    public function getEntryAttribute(): self
    {
        return $this;
    }
}
