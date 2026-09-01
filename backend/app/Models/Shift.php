<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Shift extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'created_by',
        'name',
        'start_time',
        'end_time',
        'days_of_week',
        'is_active',
        'break_minutes',
        'color',
        'timezone',
        'grace_period_minutes',
        'allow_early_check_in',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'days_of_week' => 'array',
            'is_active' => 'boolean',
            'break_minutes' => 'integer',
            'grace_period_minutes' => 'integer',
            'allow_early_check_in' => 'boolean',
        ];
    }

    /**
     * Who created this shift. Null on shifts that predate ownership — those are
     * org-owned and only org-scoped roles may edit them.
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
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
}
