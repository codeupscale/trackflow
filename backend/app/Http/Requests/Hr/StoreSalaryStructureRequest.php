<?php

namespace App\Http\Requests\Hr;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class StoreSalaryStructureRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // Unique WITHIN the position, not across the org: "L1" under two
            // different jobs is two different grades. Unlinked grades form
            // their own group. Case-insensitive, and soft-deleted rows do not
            // reserve a name. Mirrors the partial indexes in 2026_09_03_000001.
            // A closure, not Rule::unique: that rule always ANDs its own exact
            // `name = ?` comparison, so a case-insensitive check bolted onto it
            // never matches and "ENGINEER l1" slipped through to be rejected by
            // the database index as a 500 instead of a readable 422.
            'name' => [
                'required', 'string', 'max:255',
                function (string $attribute, mixed $value, \Closure $fail) {
                    $exists = DB::table('salary_structures')
                        ->where('organization_id', $this->user()->organization_id)
                        ->whereNull('deleted_at')
                        ->whereRaw('lower(name) = ?', [mb_strtolower((string) $value)])
                        ->when(
                            $this->input('position_id'),
                            fn ($q) => $q->where('position_id', $this->input('position_id')),
                            fn ($q) => $q->whereNull('position_id'),
                        )
                        ->exists();

                    if ($exists) {
                        $fail($this->input('position_id')
                            ? 'A grade with this name already exists for this position.'
                            : 'A grade with this name already exists. Link it to a position, or choose another name.');
                    }
                },
            ],
            'description' => ['nullable', 'string'],
            'type' => ['required', 'string', 'in:monthly,hourly,daily'],
            // Nullable: a grade may exist before positions are configured, which
            // is the normal state during migration.
            'position_id' => [
                'sometimes', 'nullable', 'uuid',
                Rule::exists('positions', 'id')->where('organization_id', $this->user()->organization_id),
            ],
            'base_salary' => ['required', 'numeric', 'min:0'],
            // The approved band. Both optional — a grade with no band simply has
            // no in-range check, rather than being invalid.
            'min_salary' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'max_salary' => ['sometimes', 'nullable', 'numeric', 'min:0', 'gte:min_salary'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'is_active' => ['sometimes', 'boolean'],
            'effective_from' => ['required', 'date'],
            'effective_to' => ['nullable', 'date', 'after:effective_from'],
        ];
    }

}
