<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;

class UpdatePayComponentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'type' => ['sometimes', 'string', 'in:allowance,deduction,bonus,tax'],
            'calculation_type' => ['sometimes', 'string', 'in:fixed,percentage'],
            'value' => ['sometimes', 'numeric', 'min:0'],
            'is_taxable' => ['sometimes', 'boolean'],
            'is_mandatory' => ['sometimes', 'boolean'],
            'applies_to' => ['sometimes', 'string', 'in:all,specific'],
        ];
    }
}
