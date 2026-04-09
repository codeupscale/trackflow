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
            'type'           => 'required|string|in:paid,unpaid',
            'days_per_year'  => 'required|numeric|min:0|max:365',
            'accrual_method' => 'sometimes|string|in:annual,monthly,none',
            'max_carry_over' => 'sometimes|numeric|min:0',
            'is_active'      => 'sometimes|boolean',
        ];
    }
}
