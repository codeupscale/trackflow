<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;

class StorePayComponentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'type' => ['required', 'string', 'in:allowance,deduction,bonus,tax'],
            'calculation_type' => ['required', 'string', 'in:fixed,percentage'],
            'value' => ['required', 'numeric', 'min:0'],
            'is_taxable' => ['sometimes', 'boolean'],
            'is_mandatory' => ['sometimes', 'boolean'],
            'applies_to' => ['sometimes', 'string', 'in:all,specific'],
        ];
    }
}
