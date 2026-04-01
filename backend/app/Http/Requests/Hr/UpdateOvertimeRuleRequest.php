<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOvertimeRuleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'daily_threshold_hours' => ['sometimes', 'numeric', 'min:1', 'max:24'],
            'weekly_threshold_hours' => ['sometimes', 'numeric', 'min:1', 'max:168'],
            'overtime_multiplier' => ['sometimes', 'numeric', 'min:1', 'max:5'],
            'weekend_multiplier' => ['sometimes', 'numeric', 'min:1', 'max:5'],
        ];
    }
}
