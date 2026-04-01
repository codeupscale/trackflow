<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class OvertimeRule extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'daily_threshold_hours',
        'weekly_threshold_hours',
        'overtime_multiplier',
        'weekend_multiplier',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'daily_threshold_hours' => 'decimal:2',
            'weekly_threshold_hours' => 'decimal:2',
            'overtime_multiplier' => 'decimal:2',
            'weekend_multiplier' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }
}
