<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePositionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

        return [
            'title' => ['required', 'string', 'max:255'],
            'code' => [
                'required',
                'string',
                'max:50',
                Rule::unique('positions', 'code')->where('organization_id', $orgId),
            ],
            'department_id' => [
                'required',
                'uuid',
                Rule::exists('departments', 'id')->where('organization_id', $orgId),
            ],
            'level' => ['required', Rule::in(['junior', 'mid', 'senior', 'lead', 'manager', 'director', 'vp', 'c_level'])],
            'employment_type' => ['required', Rule::in(['full_time', 'part_time', 'contract', 'intern'])],
            'min_salary' => ['nullable', 'numeric', 'min:0'],
            'max_salary' => ['nullable', 'numeric', 'gte:min_salary'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
