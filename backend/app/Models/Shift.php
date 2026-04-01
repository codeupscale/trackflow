<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Shift extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'name',
        'start_time',
        'end_time',
        'days_of_week',
        'is_active',
        'break_minutes',
        'color',
        'timezone',
        'grace_period_minutes',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'days_of_week' => 'array',
            'is_active' => 'boolean',
            'break_minutes' => 'integer',
            'grace_period_minutes' => 'integer',
        ];
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'user_shifts')
            ->withPivot('effective_from', 'effective_to')
            ->whereNull('user_shifts.deleted_at');
    }

    /**
     * Users currently assigned to this shift (effective_from <= today, effective_to is null or >= today).
     */
    public function activeUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'user_shifts')
            ->withPivot('effective_from', 'effective_to')
            ->whereNull('user_shifts.deleted_at')
            ->wherePivot('effective_from', '<=', now()->toDateString())
            ->where(function ($query) {
                $query->whereNull('user_shifts.effective_to')
                    ->orWhere('user_shifts.effective_to', '>=', now()->toDateString());
            });
    }

    /**
     * Swap requests where this shift is the requester's shift.
     */
    public function swapRequests(): HasMany
    {
        return $this->hasMany(ShiftSwapRequest::class, 'requester_shift_id');
    }
}
