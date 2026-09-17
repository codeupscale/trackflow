<?php

namespace App\Http\Requests\Hr;

use App\Support\EarlyCheckoutReasons;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Checking out, optionally explaining a short day.
 *
 * Every field is optional: a plain checkout with no body at all is still the
 * normal case, and must never 422. What the rules DO enforce is that a reason,
 * once offered, is worth reading — a category from the fixed list and a note
 * long enough to say something. "ok" clearing an Early Checkout flag would make
 * the flag meaningless within a week.
 */
class CheckOutRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // the controller authorizes via the AttendanceRecord policy
    }

    public function rules(): array
    {
        return [
            'early_checkout_category' => ['nullable', Rule::in(EarlyCheckoutReasons::keys())],
            'early_checkout_reason' => [
                'nullable',
                'string',
                'min:' . EarlyCheckoutReasons::MIN_NOTE_LENGTH,
                'max:' . EarlyCheckoutReasons::MAX_NOTE_LENGTH,
            ],
            'early_checkout_approved_by' => ['nullable', 'uuid'],
        ];
    }

    public function messages(): array
    {
        return [
            'early_checkout_reason.min' => 'Please describe the reason in a few words so HR can understand it.',
            'early_checkout_category.in' => 'Choose one of the listed reasons.',
        ];
    }

    /**
     * The service's shape. Null when nothing was offered, so a plain checkout
     * stays a plain checkout.
     */
    public function earlyReason(): ?array
    {
        $category = $this->input('early_checkout_category');

        if ($category === null) {
            return null;
        }

        return [
            'category' => $category,
            'reason' => $this->input('early_checkout_reason'),
            'approved_by' => $this->input('early_checkout_approved_by'),
        ];
    }
}
