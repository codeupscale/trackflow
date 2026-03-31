<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreLeaveRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

        return [
            'leave_type_id' => [
                'required',
                'uuid',
                Rule::exists('leave_types', 'id')->where('organization_id', $orgId),
            ],
            'start_date' => ['required', 'date', 'after_or_equal:today'],
            'end_date' => ['required', 'date', 'after_or_equal:start_date'],
            'reason' => ['required', 'string', 'max:1000'],
            'half_day' => ['sometimes', 'boolean'],
            'document' => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png', 'max:5120'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            if ($this->boolean('half_day') && $this->input('start_date') !== $this->input('end_date')) {
                $validator->errors()->add('half_day', 'Half-day leave is only valid when start date equals end date.');
            }
        });
    }
}
