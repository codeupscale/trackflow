<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Shift extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids;

    protected $fillable = [
        'organization_id',
        'name',
        'start_time',
        'end_time',
        'days_of_week',
    ];

    protected function casts(): array
    {
        return [
            'days_of_week' => 'array',
        ];
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'user_shifts')
            ->withPivot('effective_from', 'effective_to');
    }
}
