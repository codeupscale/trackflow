<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class AttendanceRecord extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'user_id',
        'date',
        'shift_id',
        'expected_start',
        'expected_end',
        'first_seen',
        'last_seen',
        'total_hours',
        'status',
        'late_minutes',
        'early_departure_minutes',
        'overtime_minutes',
        'is_regularized',
        'regularization_note',
        // Check-in / checkout session columns (Phase 2)
        'check_in_at',
        'check_out_at',
        'worked_seconds',
        'check_in_status',
        'check_in_late_minutes',
        'check_out_early_minutes',
        'check_out_overtime_minutes',
        'is_early_checkout',
        'missing_checkout',
        'check_in_flags',
        // Multi-session redesign (Module 3.1)
        'sessions_count',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'is_regularized' => 'boolean',
            'total_hours' => 'float',
            'late_minutes' => 'integer',
            'early_departure_minutes' => 'integer',
            'overtime_minutes' => 'integer',
            // Check-in / checkout session casts (Phase 2)
            'check_in_at' => 'datetime',
            'check_out_at' => 'datetime',
            'check_in_flags' => 'array',
            'worked_seconds' => 'integer',
            'check_in_late_minutes' => 'integer',
            'check_out_early_minutes' => 'integer',
            'check_out_overtime_minutes' => 'integer',
            'is_early_checkout' => 'boolean',
            'missing_checkout' => 'boolean',
            // Multi-session redesign (Module 3.1)
            'sessions_count' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    public function regularizations(): HasMany
    {
        return $this->hasMany(AttendanceRegularization::class);
    }

    /**
     * Check-in/checkout sessions for this day's record, ordered by their
     * 1-based per-day sequence (multi-session redesign, Module 3.1).
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(CheckInSession::class)->orderBy('seq');
    }

    /**
     * Scope to filter attendance records within a date range.
     */
    public function scopeForDateRange(Builder $query, string $from, string $to): Builder
    {
        return $query->whereBetween('date', [$from, $to]);
    }

    // NOTE: The former scopeOpenSessions() was removed in the multi-session redesign.
    // Under multi-session, a record's check_out_at holds the LAST closed session's
    // checkout, so "check_in_at NOT NULL AND check_out_at NULL" no longer means
    // "still checked in" (a later session can be open while an earlier one is closed).
    // Open-session lookups now live on CheckInSession::open() / the idx_cis_open index.
}
