<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateEmployeeProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;
        $user = $this->user();

        // Personal fields that any employee can edit on their own profile
        $personalRules = [
            'blood_group' => ['sometimes', 'nullable', 'string', 'max:10'],
            'marital_status' => ['sometimes', 'nullable', 'string', 'max:20'],
            'nationality' => ['sometimes', 'nullable', 'string', 'max:100'],
            'gender' => ['sometimes', 'nullable', 'string', 'max:20'],
            'emergency_contact_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'emergency_contact_phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'emergency_contact_relation' => ['sometimes', 'nullable', 'string', 'max:50'],
            'current_address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'permanent_address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'bank_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'bank_account_number' => ['sometimes', 'nullable', 'string', 'max:50'],
            'bank_routing_number' => ['sometimes', 'nullable', 'string', 'max:50'],
            'tax_id' => ['sometimes', 'nullable', 'string', 'max:50'],
        ];

        // Admin/owner fields
        if ($user->hasRole('owner', 'admin')) {
            return array_merge($personalRules, [
                'department_id' => [
                    'sometimes', 'nullable', 'uuid',
                    Rule::exists('departments', 'id')->where('organization_id', $orgId),
                ],
                'position_id' => [
                    'sometimes', 'nullable', 'uuid',
                    Rule::exists('positions', 'id')->where('organization_id', $orgId),
                ],
                'reporting_manager_id' => [
                    'sometimes', 'nullable', 'uuid',
                    Rule::exists('users', 'id')->where('organization_id', $orgId),
                ],
                'employment_status' => [
                    'sometimes', 'string',
                    Rule::in(['active', 'probation', 'notice_period', 'terminated', 'resigned']),
                ],
                'employment_type' => [
                    'sometimes', 'string',
                    Rule::in(['full_time', 'part_time', 'contract', 'intern']),
                ],
                'date_of_joining' => ['sometimes', 'nullable', 'date'],
                'date_of_confirmation' => ['sometimes', 'nullable', 'date'],
                'date_of_exit' => ['sometimes', 'nullable', 'date'],
                'probation_end_date' => ['sometimes', 'nullable', 'date'],
            ]);
        }

        return $personalRules;
    }
}
