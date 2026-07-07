<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Validates a manual time entry. Authorization (create + on-behalf scope) is
 * enforced in the controller policy and ManualTimeEntryService.
 */
class StoreTimeEntryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        $orgId = $this->user()->organization_id;

        return [
            // Optional target user for on-behalf entries. Must belong to the org.
            'user_id' => [
                'nullable',
                'uuid',
                Rule::exists('users', 'id')->where('organization_id', $orgId),
            ],
            'project_id' => ['nullable', 'uuid'],
            'task_id' => ['nullable', 'uuid'],
            'started_at' => ['required', 'date', 'before_or_equal:now'],
            'ended_at' => ['required', 'date', 'after:started_at'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    public function messages(): array
    {
        return [
            'ended_at.after' => 'The end time must be after the start time.',
            'started_at.before_or_equal' => 'Time entries cannot start in the future.',
        ];
    }
}
