<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;

class StorePublicHolidayRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasRole('owner', 'admin');
    }

    public function rules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'date' => 'required|date',
            'is_recurring' => 'sometimes|boolean',
        ];
    }
}
