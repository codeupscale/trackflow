<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayslipLineItem extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'payslip_id',
        'pay_component_id',
        'label',
        'type',
        'category',
        'amount',
        'is_taxable',
        'sort_order',
    ];

    /**
     * What a line IS, as opposed to which side of the payslip it falls on.
     * `type` (earning/deduction) cannot distinguish tax from a loan
     * repayment, which is what the payroll listing needs to total by column.
     */
    public const CATEGORIES = ['basic', 'allowance', 'bonus', 'overtime', 'tax', 'deduction', 'other'];

    /** Categories that add to pay; anything else subtracts. */
    public const EARNING_CATEGORIES = ['basic', 'allowance', 'bonus', 'overtime'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'is_taxable' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    public function payslip(): BelongsTo
    {
        return $this->belongsTo(Payslip::class);
    }

    public function payComponent(): BelongsTo
    {
        return $this->belongsTo(PayComponent::class);
    }
}
