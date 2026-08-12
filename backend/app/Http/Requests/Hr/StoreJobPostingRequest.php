<?php

namespace App\Http\Requests\Hr;

use App\Http\Requests\Hr\Concerns\SanitizesJobDescription;
use App\Http\Requests\Hr\Concerns\ValidatesJobPostingSalary;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreJobPostingRequest extends FormRequest
{
    use SanitizesJobDescription, ValidatesJobPostingSalary;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->sanitizeLongDescriptionInput();
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

        return [
            'title' => ['required', 'string', 'max:255'],
            'department_id' => [
                'required',
                'uuid',
                Rule::exists('departments', 'id')->where('organization_id', $orgId),
            ],
            'position_id' => [
                'nullable',
                'uuid',
                Rule::exists('positions', 'id')->where('organization_id', $orgId),
            ],
            'employment_type' => ['required', Rule::in(['full_time', 'part_time', 'contract', 'intern'])],
            'work_mode' => ['required', Rule::in(['on_site', 'remote', 'hybrid'])],
            'location' => ['nullable', 'string', 'max:255'],
            'posting_date' => ['nullable', 'date'],
            'start_time' => ['nullable', 'date_format:H:i,H:i:s'],
            'end_time' => ['nullable', 'date_format:H:i,H:i:s'],
            // gt:0 rather than min:1 — any positive amount is a valid salary,
            // but zero and negatives are not. min:1 would have rejected
            // fractional amounts for no good reason.
            'min_salary' => ['nullable', 'numeric', 'gt:0'],
            'max_salary' => ['nullable', 'numeric', 'gt:0'],
            'send_salary_via_api' => ['sometimes', 'boolean'],
            'short_description' => ['nullable', 'string', 'max:500'],
            // Sanitised HTML — the limit applies to the cleaned markup, since
            // prepareForValidation runs first.
            'long_description' => ['nullable', 'string', 'max:60000'],
            // is_published is deliberately absent: publishing is a separate
            // action behind job_postings.publish, so an editor cannot push a
            // posting live through an ordinary save. Postings start as drafts.
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                $this->applySalaryRules($validator);
                $this->applyPositionBelongsToDepartment($validator);
                $this->applyWorkingHoursRule($validator);
            },
        ];
    }
}
