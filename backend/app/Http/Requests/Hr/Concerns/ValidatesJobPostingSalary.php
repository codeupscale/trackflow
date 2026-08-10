<?php

namespace App\Http\Requests\Hr\Concerns;

use App\Models\Position;
use Illuminate\Validation\Validator;

/**
 * Cross-field rules shared by Store and Update.
 *
 * Deliberately NOT expressed as `'max_salary' => ['gte:min_salary']` the way
 * StorePositionRequest does it. When min_salary is absent, `gte` compares the
 * value against null and the comparison fails — which would reject the
 * "max only / up to" case this feature specifically requires. Positions never
 * hit that because nothing there depends on max-without-min.
 *
 * "At least one" is also asserted once rather than as required_if on both
 * fields, so a single mistake produces a single error message.
 *
 * Rules run against the EFFECTIVE record — the payload merged over what is
 * already stored — so a partial update that only flips send_salary_via_api
 * still sees the salary that is already on the posting.
 */
trait ValidatesJobPostingSalary
{
    /**
     * Value after the request is applied. Store uses the payload as-is;
     * Update overrides this to fall back to the persisted posting.
     */
    protected function effectiveValue(string $key): mixed
    {
        return $this->input($key);
    }

    protected function effectiveBool(string $key): bool
    {
        return (bool) filter_var(
            $this->effectiveValue($key),
            FILTER_VALIDATE_BOOLEAN,
        );
    }

    protected function applySalaryRules(Validator $validator): void
    {
        $min = $this->effectiveValue('min_salary');
        $max = $this->effectiveValue('max_salary');

        $hasMin = $min !== null && $min !== '';
        $hasMax = $max !== null && $max !== '';

        // Compare only when both sides actually exist. Strictly greater: a
        // range whose ends are equal is a single figure, not a range, so it is
        // rejected rather than silently rendered as "80,000 - 80,000".
        if ($hasMin && $hasMax && (float) $max <= (float) $min) {
            $validator->errors()->add(
                'max_salary',
                'Maximum salary must be greater than the minimum salary.',
            );
        }

        // Publishing a range requires something to publish.
        if ($this->effectiveBool('send_salary_via_api') && ! $hasMin && ! $hasMax) {
            $validator->errors()->add(
                'min_salary',
                'Enter a minimum or a maximum salary to publish a salary range.',
            );
        }
    }

    /**
     * A posting's position must belong to its department, otherwise the careers
     * page would advertise a role under the wrong team.
     */
    protected function applyPositionBelongsToDepartment(Validator $validator): void
    {
        $positionId = $this->effectiveValue('position_id');
        $departmentId = $this->effectiveValue('department_id');

        if (! $positionId || ! $departmentId) {
            return;
        }

        $belongs = Position::withoutGlobalScopes()
            ->where('id', $positionId)
            ->where('organization_id', $this->user()->organization_id)
            ->where('department_id', $departmentId)
            ->exists();

        if (! $belongs) {
            $validator->errors()->add(
                'position_id',
                'The selected position does not belong to the selected department.',
            );
        }
    }

    protected function applyWorkingHoursRule(Validator $validator): void
    {
        $start = $this->effectiveValue('start_time');
        $end = $this->effectiveValue('end_time');

        if (! $start || ! $end) {
            return;
        }

        // Overnight shifts are legitimate, so only an exact match is rejected.
        if ($start === $end) {
            $validator->errors()->add(
                'end_time',
                'End time must be different from the start time.',
            );
        }
    }
}
