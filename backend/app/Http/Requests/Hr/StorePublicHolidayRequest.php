<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePublicHolidayRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasRole('owner', 'org_manager', 'hr_manager');
    }

    public function rules(): array
    {
        // public_holidays has a unique(org, date, name) constraint. Without a
        // matching validation rule a duplicate surfaced as a 500; this turns it
        // into a 422 with a usable message. On edit the row ignores itself, so
        // re-saving a holiday unchanged is not a conflict.
        $holidayId = $this->route('public_holiday');

        return [
            'name' => [
                'required', 'string', 'max:255',
                Rule::unique('public_holidays', 'name')
                    ->where('organization_id', $this->user()->organization_id)
                    ->where('date', $this->input('date'))
                    ->ignore($holidayId),
            ],
            'date' => 'required|date',
            'is_recurring' => 'sometimes|boolean',
        ];
    }

    public function messages(): array
    {
        return [
            'name.unique' => 'A holiday with this name already exists on that date.',
        ];
    }
}
