<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class PayComponent extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'name',
        'type',
        'calculation_type',
        'value',
        'is_taxable',
        'is_mandatory',
        'applies_to',
    ];

    protected function casts(): array
    {
        return [
            'value' => 'decimal:4',
            'is_taxable' => 'boolean',
            'is_mandatory' => 'boolean',
        ];
    }
}
