<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateSalaryStructureRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'type' => ['sometimes', 'string', 'in:monthly,hourly,daily'],
            'position_id' => [
                'sometimes', 'nullable', 'uuid',
                Rule::exists('positions', 'id')->where('organization_id', $this->user()->organization_id),
            ],
            'base_salary' => ['sometimes', 'numeric', 'min:0'],
            'min_salary' => ['sometimes','nullable','numeric','min:0'],
            'max_salary' => ['sometimes','nullable','numeric','min:0','gte:min_salary'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'is_active' => ['sometimes', 'boolean'],
            'effective_from' => ['sometimes', 'date'],
            'effective_to' => ['nullable', 'date', 'after:effective_from'],
        ];
    }
}
