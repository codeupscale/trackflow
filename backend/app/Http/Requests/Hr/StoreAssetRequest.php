<?php

namespace App\Http\Requests\Hr;

use App\Models\Asset;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Create or edit an asset. Authorization is the route's assets.manage gate.
 *
 * Deliberately NOT accepted: current_holder_id, and 'assigned' as a status.
 * An item only changes hands through the assign and return endpoints, which is
 * what keeps every hand-over on record.
 */
class StoreAssetRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $assetId = $this->route('asset')?->id ?? $this->route('asset');
        $orgId = $this->user()->organization_id;
        $isUpdate = $this->isMethod('put') || $this->isMethod('patch');
        $required = $isUpdate ? 'sometimes' : 'required';

        return [
            'name' => [$required, 'string', 'max:255'],
            'category' => [$required, 'string', Rule::in(Asset::CATEGORIES)],
            'brand' => ['nullable', 'string', 'max:120'],
            'model' => ['nullable', 'string', 'max:120'],
            'serial_number' => [
                'nullable', 'string', 'max:120',
                // Mirrors the partial unique index, so a duplicate serial is a
                // readable 422 rather than a database error.
                Rule::unique('assets', 'serial_number')
                    ->where('organization_id', $orgId)
                    ->whereNull('deleted_at')
                    ->ignore($assetId),
            ],
            'purchase_date' => ['nullable', 'date', 'before_or_equal:today'],
            'purchase_cost' => ['nullable', 'numeric', 'min:0', 'max:999999999999'],
            'warranty_expires_on' => ['nullable', 'date', 'after_or_equal:purchase_date'],
            'status' => ['sometimes', 'string', Rule::in(array_diff(Asset::STATUSES, ['assigned']))],
            'condition' => ['sometimes', 'string', Rule::in(Asset::CONDITIONS)],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function messages(): array
    {
        return [
            'serial_number.unique' => 'Another item in this organization already has that serial number.',
            'status.in' => 'Choose a valid status. To give an item to someone, use Assign.',
            'warranty_expires_on.after_or_equal' => 'The warranty cannot end before the purchase date.',
        ];
    }
}
