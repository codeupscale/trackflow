<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class EmployeeProfile extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids;

    protected $fillable = [
        'organization_id',
        'user_id',
        'employee_id',
        'department_id',
        'position_id',
        'reporting_manager_id',
        'employment_status',
        'employment_type',
        'date_of_joining',
        'date_of_confirmation',
        'date_of_exit',
        'probation_end_date',
        'blood_group',
        'marital_status',
        'nationality',
        'gender',
        'emergency_contact_name',
        'emergency_contact_phone',
        'emergency_contact_relation',
        'bank_name',
        'bank_account_number',
        'bank_routing_number',
        'tax_id',
        'current_address',
        'permanent_address',
    ];

    protected $hidden = [
        'bank_name',
        'bank_account_number',
        'bank_routing_number',
        'tax_id',
    ];

    protected function casts(): array
    {
        return [
            'bank_name' => 'encrypted',
            'bank_account_number' => 'encrypted',
            'bank_routing_number' => 'encrypted',
            'tax_id' => 'encrypted',
            'date_of_joining' => 'date',
            'date_of_confirmation' => 'date',
            'date_of_exit' => 'date',
            'probation_end_date' => 'date',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    public function reportingManager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporting_manager_id');
    }

    public function documents(): HasMany
    {
        return $this->hasMany(EmployeeDocument::class, 'user_id', 'user_id')
            ->where('organization_id', $this->organization_id);
    }

    public function notes(): HasMany
    {
        return $this->hasMany(EmployeeNote::class, 'user_id', 'user_id')
            ->where('organization_id', $this->organization_id);
    }
}
