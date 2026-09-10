<?php

namespace App\Models;

use App\Models\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Payslip extends Model
{
    use BelongsToOrganization, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id',
        'user_id',
        'payroll_period_id',
        'gross_salary',
        'total_deductions',
        'total_allowances',
        'net_salary',
        // The currency this payslip was produced in. Null means "the org's
        // current one" — true for every payslip until the org switches.
        'currency',
        'status',
        'payment_date',
        'payment_method',
        'notes',
        'verified_at',
        'verified_by',
        'withdrawn_at',
        'withdrawn_by',
    ];

    /**
     * Has this payslip been released to the employee?
     *
     * Verified AND not since withdrawn. The two are recorded separately so the
     * history survives — withdrawing used to erase the verification, leaving no
     * trace that the document had ever been checked or by whom.
     */
    public function isVerified(): bool
    {
        return $this->verified_at !== null && $this->withdrawn_at === null;
    }

    public function withdrawnBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'withdrawn_by');
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    protected function casts(): array
    {
        return [
            'gross_salary' => 'decimal:2',
            'total_deductions' => 'decimal:2',
            'total_allowances' => 'decimal:2',
            'net_salary' => 'decimal:2',
            'payment_date' => 'date',
            'verified_at' => 'datetime',
            'withdrawn_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function payrollPeriod(): BelongsTo
    {
        return $this->belongsTo(PayrollPeriod::class);
    }

    public function lineItems(): HasMany
    {
        return $this->hasMany(PayslipLineItem::class);
    }
}
