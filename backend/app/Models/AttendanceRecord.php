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
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'is_regularized' => 'boolean',
            'total_hours' => 'decimal:2',
            'late_minutes' => 'integer',
            'early_departure_minutes' => 'integer',
            'overtime_minutes' => 'integer',
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
     * Scope to filter attendance records within a date range.
     */
    public function scopeForDateRange(Builder $query, string $from, string $to): Builder
    {
        return $query->whereBetween('date', [$from, $to]);
    }
}
