<?php

namespace App\Http\Requests\Hr;

use App\Services\PermissionService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateEmployeeProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $nullableFields = [
            'employee_id',
            'department_id',
            'position_id',
            'reporting_manager_id',
            'employment_status',
            'employment_type',
            'date_of_joining',
            'date_of_confirmation',
            'date_of_exit',
            'probation_end_date',
            'notice_period_days',
            'work_location',
            'blood_group',
            'marital_status',
            'nationality',
            'gender',
            'emergency_contact_name',
            'emergency_contact_phone',
            'emergency_contact_relation',
            'current_address',
            'permanent_address',
            'bank_name',
            'bank_account_number',
            'bank_routing_number',
            'tax_id',
        ];

        $normalized = [];
        foreach ($nullableFields as $field) {
            if ($this->has($field) && $this->input($field) === '') {
                $normalized[$field] = null;
            }
        }

        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

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

        // Employment fields — anyone with org-scoped employees.edit_profile (owner/admin/HR)
        if ($this->canEditEmploymentFields()) {
            return array_merge($personalRules, [
                'name' => ['sometimes', 'string', 'min:2', 'max:255'],
                'email' => ['sometimes', 'email', 'max:255'],
                'job_title' => ['sometimes', 'nullable', 'string', 'max:255'],
                'employee_id' => ['sometimes', 'nullable', 'string', 'max:50'],
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
                    Rule::exists('users', 'id')
                        ->where('organization_id', $orgId)
                        // Only managerial roles — not employees.
                        ->whereIn('role', [
                            'owner',
                            'org_manager',
                            'hr_manager',
                            'finance_manager',
                            'admin',   // legacy alias of org_manager
                            'manager', // legacy project manager role
                        ]),
                ],
                'employment_status' => [
                    'sometimes', 'nullable', 'string',
                    Rule::in(['active', 'probation', 'notice_period', 'terminated', 'resigned']),
                ],
                'employment_type' => [
                    'sometimes', 'nullable', 'string',
                    Rule::in(['full_time', 'part_time', 'contract', 'intern']),
                ],
                'date_of_joining' => ['sometimes', 'nullable', 'date'],
                'date_of_confirmation' => ['sometimes', 'nullable', 'date'],
                'date_of_exit' => ['sometimes', 'nullable', 'date'],
                'probation_end_date' => ['sometimes', 'nullable', 'date'],
                'notice_period_days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:365'],
                'work_location' => ['sometimes', 'nullable', 'string', 'max:255'],
            ]);
        }

        return $personalRules;
    }

    private function canEditEmploymentFields(): bool
    {
        return app(PermissionService::class)->hasPermission(
            $this->user(),
            'employees.edit_profile',
            'organization'
        );
    }
}
