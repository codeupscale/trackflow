<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreLeaveTypeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasRole('owner', 'admin');
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

        return [
            'name' => 'required|string|max:100',
            'code' => [
                'required', 'string', 'max:20',
                Rule::unique('leave_types', 'code')->where('organization_id', $orgId),
            ],
            'is_paid' => 'sometimes|boolean',
            'days_per_year' => 'required|numeric|min:0|max:365',
            'accrual_type' => 'sometimes|string|in:upfront,monthly,anniversary',
            'carryover_days' => 'sometimes|numeric|min:0',
            'max_consecutive_days' => 'nullable|integer|min:1',
            'requires_document' => 'sometimes|boolean',
            'requires_approval' => 'sometimes|boolean',
            'applicable_genders' => 'sometimes|string|in:all,male,female',
        ];
    }
}
