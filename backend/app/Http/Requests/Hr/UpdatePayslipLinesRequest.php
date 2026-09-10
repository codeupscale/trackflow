<?php

namespace App\Http\Requests\Hr;

use App\Models\PayslipLineItem;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePayslipLinesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // An empty array is legal: clearing every line leaves a zero
            // payslip, which is a valid thing to want before rebuilding it.
            'lines' => ['present', 'array', 'max:60'],
            'lines.*.label' => ['required', 'string', 'max:120'],
            'lines.*.category' => ['required', Rule::in(PayslipLineItem::CATEGORIES)],
            // Amounts are always POSITIVE. Which side of the payslip a line
            // falls on is decided by its category, so a negative deduction
            // would quietly add to someone's pay.
            'lines.*.amount' => ['required', 'numeric', 'min:0', 'max:999999999'],
            'lines.*.is_taxable' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.*.amount.min' => 'Amounts must be positive — the category decides whether a line adds or subtracts.',
        ];
    }
}
