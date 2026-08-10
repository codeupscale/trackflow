<?php

namespace App\Http\Requests\Hr;

use App\Http\Requests\Hr\Concerns\SanitizesJobDescription;
use App\Http\Requests\Hr\Concerns\ValidatesJobPostingSalary;
use App\Models\JobPosting;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateJobPostingRequest extends FormRequest
{
    use SanitizesJobDescription, ValidatesJobPostingSalary;

    private ?JobPosting $posting = null;

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
            'title' => ['sometimes', 'string', 'max:255'],
            'department_id' => [
                'sometimes',
                'uuid',
                Rule::exists('departments', 'id')->where('organization_id', $orgId),
            ],
            'position_id' => [
                'nullable',
                'uuid',
                Rule::exists('positions', 'id')->where('organization_id', $orgId),
            ],
            'employment_type' => ['sometimes', Rule::in(['full_time', 'part_time', 'contract', 'intern'])],
            'work_mode' => ['sometimes', Rule::in(['on_site', 'remote', 'hybrid'])],
            'location' => ['nullable', 'string', 'max:255'],
            'posting_date' => ['nullable', 'date'],
            'start_time' => ['nullable', 'date_format:H:i,H:i:s'],
            'end_time' => ['nullable', 'date_format:H:i,H:i:s'],
            // See StoreJobPostingRequest: any positive amount, never 0 or below.
            'min_salary' => ['nullable', 'numeric', 'gt:0'],
            'max_salary' => ['nullable', 'numeric', 'gt:0'],
            'send_salary_via_api' => ['sometimes', 'boolean'],
            'short_description' => ['nullable', 'string', 'max:500'],
            'long_description' => ['nullable', 'string', 'max:60000'],
            // See StoreJobPostingRequest: publishing goes through its own
            // endpoint so job_postings.edit cannot be used to go live.
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

    /**
     * Fields absent from a partial update keep their stored value, so the
     * cross-field rules judge the record as it will be, not as it was sent.
     */
    protected function effectiveValue(string $key): mixed
    {
        if ($this->has($key)) {
            return $this->input($key);
        }

        return $this->existingPosting()?->getAttribute($key);
    }

    private function existingPosting(): ?JobPosting
    {
        if ($this->posting !== null) {
            return $this->posting;
        }

        $id = $this->route('job_posting');

        if (! $id) {
            return null;
        }

        return $this->posting = JobPosting::withoutGlobalScopes()
            ->where('organization_id', $this->user()->organization_id)
            ->find($id);
    }
}
