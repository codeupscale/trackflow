<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateDepartmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;
        $departmentId = $this->route('department');

        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'code' => [
                'sometimes',
                'string',
                'max:50',
                Rule::unique('departments', 'code')
                    ->where('organization_id', $orgId)
                    ->ignore($departmentId),
            ],
            'description' => ['nullable', 'string'],
            'parent_department_id' => [
                'nullable',
                'uuid',
                Rule::exists('departments', 'id')->where('organization_id', $orgId),
            ],
            'manager_id' => [
                'nullable',
                'uuid',
                Rule::exists('users', 'id')->where('organization_id', $orgId),
            ],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
