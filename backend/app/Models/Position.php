<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Position extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'department_id',
        'title',
        'code',
        'level',
        'employment_type',
        'min_salary',
        'max_salary',
        'is_active',
    ];

    /**
     * Salary fields are hidden from default serialization.
     * Access only via explicit admin-gated endpoints.
     */
    protected $hidden = ['min_salary', 'max_salary'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'min_salary' => 'encrypted',
            'max_salary' => 'encrypted',
        ];
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }
}
