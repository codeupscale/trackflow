<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LeaveType extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids;

    protected $fillable = [
        'organization_id',
        'name',
        'code',
        'is_paid',
        'days_per_year',
        'accrual_type',
        'carryover_days',
        'max_consecutive_days',
        'requires_document',
        'requires_approval',
        'applicable_genders',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'is_paid' => 'boolean',
            'requires_document' => 'boolean',
            'requires_approval' => 'boolean',
            'is_active' => 'boolean',
            'days_per_year' => 'decimal:1',
            'carryover_days' => 'decimal:1',
            'max_consecutive_days' => 'integer',
        ];
    }

    public function balances(): HasMany
    {
        return $this->hasMany(LeaveBalance::class);
    }

    public function requests(): HasMany
    {
        return $this->hasMany(LeaveRequest::class);
    }
}
