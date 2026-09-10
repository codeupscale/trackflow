<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class BulkAssignSalaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

        return [
            // Bounded: a bulk assign writes one row per employee inside a
            // single transaction, so an unbounded list is a long-held lock on
            // the salary table.
            'user_ids' => ['required', 'array', 'min:1', 'max:500'],
            'user_ids.*' => [
                'uuid',
                // Scoped to the caller's org in the rule itself, not just in
                // the service: a crafted id must fail validation rather than
                // reach business logic at all.
                Rule::exists('users', 'id')->where('organization_id', $orgId),
            ],
            'salary_structure_id' => [
                'required',
                'uuid',
                Rule::exists('salary_structures', 'id')->where('organization_id', $orgId),
            ],
            'custom_base_salary' => ['nullable', 'numeric', 'min:0'],
            'effective_from' => ['required', 'date'],
            'effective_to' => ['nullable', 'date', 'after:effective_from'],
        ];
    }

    public function messages(): array
    {
        return [
            'user_ids.required' => 'Select at least one employee.',
            'user_ids.*.exists' => 'One of the selected employees is not in your organization.',
        ];
    }
}
