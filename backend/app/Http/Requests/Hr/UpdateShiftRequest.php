<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateShiftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;
        $shiftId = $this->route('shift');

        return [
            'name' => [
                'sometimes',
                'string',
                'max:255',
                Rule::unique('shifts', 'name')
                    ->where('organization_id', $orgId)
                    ->ignore($shiftId),
            ],
            'start_time' => ['sometimes', 'date_format:H:i'],
            'end_time' => ['sometimes', 'date_format:H:i'],
            'days_of_week' => ['sometimes', 'array'],
            'days_of_week.*' => ['string', Rule::in(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])],
            'break_minutes' => ['sometimes', 'integer', 'min:0', 'max:120'],
            'grace_period_minutes' => ['sometimes', 'integer', 'min:0', 'max:60'],
            'color' => ['sometimes', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'timezone' => ['sometimes', 'string', 'timezone'],
            'description' => ['nullable', 'string'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
