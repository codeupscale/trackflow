<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class AttendancePolicy extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'check_in_time',
        'late_threshold',
        'checkout_time',
        'timezone',
        'allow_early_check_in',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            // Times kept as strings ('HH:MM:SS') — they are wall-clock policy values,
            // not absolute datetimes.
            'allow_early_check_in' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
