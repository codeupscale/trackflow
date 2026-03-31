<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePositionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;
        $positionId = $this->route('position');

        return [
            'title' => ['sometimes', 'string', 'max:255'],
            'code' => [
                'sometimes',
                'string',
                'max:50',
                Rule::unique('positions', 'code')
                    ->where('organization_id', $orgId)
                    ->ignore($positionId),
            ],
            'department_id' => [
                'sometimes',
                'uuid',
                Rule::exists('departments', 'id')->where('organization_id', $orgId),
            ],
            'level' => ['sometimes', Rule::in(['junior', 'mid', 'senior', 'lead', 'manager', 'director', 'vp', 'c_level'])],
            'employment_type' => ['sometimes', Rule::in(['full_time', 'part_time', 'contract', 'intern'])],
            'min_salary' => ['nullable', 'numeric', 'min:0'],
            'max_salary' => ['nullable', 'numeric', 'gte:min_salary'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
