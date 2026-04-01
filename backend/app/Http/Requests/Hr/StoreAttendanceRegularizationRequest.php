<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;

class StoreAttendanceRegularizationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'requested_status' => ['required', 'string', 'in:present,half_day'],
            'reason' => ['required', 'string', 'max:500'],
        ];
    }
}
