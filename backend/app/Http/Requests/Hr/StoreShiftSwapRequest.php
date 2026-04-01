<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreShiftSwapRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

        return [
            'target_user_id' => [
                'required',
                'uuid',
                Rule::exists('users', 'id')->where('organization_id', $orgId),
                'different:' . $this->user()->id,
            ],
            'swap_date' => ['required', 'date', 'after:today'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }

    public function messages(): array
    {
        return [
            'target_user_id.different' => 'You cannot create a swap request with yourself.',
            'swap_date.after' => 'Swap date must be in the future.',
        ];
    }
}
