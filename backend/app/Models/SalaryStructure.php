<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class SalaryStructure extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'position_id',
        'name',
        'description',
        'type',
        'base_salary',
        'min_salary',
        'max_salary',
        'currency',
        'is_active',
        'effective_from',
        'effective_to',
    ];

    protected function casts(): array
    {
        return [
            'base_salary' => 'decimal:2',
            'min_salary' => 'decimal:2',
            'max_salary' => 'decimal:2',
            'is_active' => 'boolean',
            'effective_from' => 'date',
            'effective_to' => 'date',
        ];
    }

    /** The job this grade is a level of. Null while a grade is unlinked. */
    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    /**
     * Is this amount inside the approved band?
     *
     * Returns NULL when no band is configured — "unknown", which callers must
     * not render as a violation. A grade with no band is the normal state for
     * an organization that has not finished configuring pay.
     */
    public function isWithinBand(float $amount): ?bool
    {
        if ($this->min_salary === null && $this->max_salary === null) {
            return null;
        }

        if ($this->min_salary !== null && $amount < (float) $this->min_salary) {
            return false;
        }

        return ! ($this->max_salary !== null && $amount > (float) $this->max_salary);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(EmployeeSalaryAssignment::class);
    }
}
