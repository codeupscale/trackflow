<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;

class StoreEmployeeNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'content' => ['required', 'string', 'max:5000'],
            'is_confidential' => ['sometimes', 'boolean'],
        ];
    }
}
