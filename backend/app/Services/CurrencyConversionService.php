<?php

namespace App\Services;

use App\Models\EmployeeSalaryAssignment;
use App\Models\Organization;
use App\Models\PayComponent;
use App\Models\Payslip;
use App\Models\Project;
use App\Models\SalaryStructure;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Change an organization's currency and convert every stored amount to it.
 *
 * The product holds ONE currency per organization and never converts at read
 * time, so changing the setting alone would not reprice anything — it would
 * restate it. A 150,000 PKR salary would start reading as $150,000, which is
 * not a formatting difference but a 280-fold error in what someone is paid.
 * The rate is therefore applied once, to the data, at the moment of the change.
 *
 * The rate is supplied by the operator rather than fetched. A payroll figure
 * should be traceable to a decision a person made on a date, not to whatever a
 * third-party endpoint happened to return; and a feed that is unreachable at
 * the moment of the switch must not be able to half-convert an organization.
 *
 * What is NOT converted, deliberately:
 *
 *   - Percentage pay components. A 10% tax is a ratio; multiplying it by an
 *     exchange rate turns it into 0.036%.
 *   - Payslips and their line items. They record money that already moved.
 *     Each is stamped with the currency it was produced in so it keeps
 *     rendering as paid, rather than being restated or rewritten.
 */
class CurrencyConversionService
{
    /**
     * What a conversion would do, without doing it.
     *
     * @return array{from:string,to:string,rate:float,counts:array<string,int>,samples:list<array{label:string,before:string,after:string}>}
     */
    public function preview(Organization $org, string $to, float $rate): array
    {
        $from = Money::currencyFor($org->id);

        $samples = [];

        $structures = SalaryStructure::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->orderBy('name')
            ->get();

        foreach ($structures->take(3) as $structure) {
            $samples[] = [
                'label' => $structure->name,
                'before' => Money::format($structure->base_salary, $from),
                'after' => Money::format($this->apply($structure->base_salary, $rate), $to),
            ];
        }

        return [
            'from' => $from,
            'to' => $to,
            'rate' => $rate,
            'counts' => [
                'salary_structures' => $structures->count(),
                'custom_salaries' => EmployeeSalaryAssignment::withoutGlobalScopes()
                    ->where('organization_id', $org->id)
                    ->whereNotNull('custom_base_salary')
                    ->count(),
                'pay_components' => PayComponent::withoutGlobalScopes()
                    ->where('organization_id', $org->id)
                    ->where('calculation_type', 'fixed')
                    ->count(),
                'project_rates' => Project::withoutGlobalScopes()
                    ->where('organization_id', $org->id)
                    ->whereNotNull('hourly_rate')
                    ->count(),
                'payslips_stamped' => Payslip::withoutGlobalScopes()
                    ->where('organization_id', $org->id)
                    ->whereNull('currency')
                    ->count(),
            ],
            'samples' => $samples,
        ];
    }

    /**
     * Apply the rate and switch the organization over.
     *
     * One transaction: an organization whose salary grades converted but whose
     * project rates did not is in a state no screen can render honestly.
     *
     * @return array<string,int> what was touched
     */
    public function convert(Organization $org, string $to, float $rate): array
    {
        $from = Money::currencyFor($org->id);

        return DB::transaction(function () use ($org, $from, $to, $rate) {
            $touched = [];

            // Stamped FIRST, and with the OLD currency, while it is still the
            // org's answer. A payslip written before the switch was paid in
            // `from`, and the stamp is the only thing that will still say so
            // once the setting moves.
            $touched['payslips_stamped'] = Payslip::withoutGlobalScopes()
                ->where('organization_id', $org->id)
                ->whereNull('currency')
                ->update(['currency' => $from]);

            $touched['salary_structures'] = 0;
            foreach (SalaryStructure::withoutGlobalScopes()->where('organization_id', $org->id)->get() as $structure) {
                $structure->base_salary = $this->apply($structure->base_salary, $rate);
                $structure->min_salary = $structure->min_salary === null
                    ? null
                    : $this->apply($structure->min_salary, $rate);
                $structure->max_salary = $structure->max_salary === null
                    ? null
                    : $this->apply($structure->max_salary, $rate);
                // The column is kept in step with the org so nothing reads a
                // stale code off a grade.
                $structure->currency = $to;
                $structure->save();
                $touched['salary_structures']++;
            }

            // Model-by-model, not an UPDATE ... * rate: `custom_base_salary` is
            // encrypted at rest, so the ciphertext has to be decrypted, scaled
            // and re-encrypted. SQL cannot multiply it.
            $touched['custom_salaries'] = 0;
            foreach (
                EmployeeSalaryAssignment::withoutGlobalScopes()
                    ->where('organization_id', $org->id)
                    ->whereNotNull('custom_base_salary')
                    ->get() as $assignment
            ) {
                $assignment->custom_base_salary = $this->apply($assignment->custom_base_salary, $rate);
                $assignment->save();
                $touched['custom_salaries']++;
            }

            // Fixed amounts only. A percentage is a ratio and converting it
            // would turn a 10% tax into 0.036%.
            $touched['pay_components'] = 0;
            foreach (
                PayComponent::withoutGlobalScopes()
                    ->where('organization_id', $org->id)
                    ->where('calculation_type', 'fixed')
                    ->get() as $component
            ) {
                $component->value = $this->apply($component->value, $rate);
                $component->save();
                $touched['pay_components']++;
            }

            $touched['project_rates'] = 0;
            foreach (
                Project::withoutGlobalScopes()
                    ->where('organization_id', $org->id)
                    ->whereNotNull('hourly_rate')
                    ->get() as $project
            ) {
                $project->hourly_rate = $this->apply($project->hourly_rate, $rate);
                $project->save();
                $touched['project_rates']++;
            }

            $settings = $org->settings ?? [];
            $settings['currency'] = $to;
            $org->settings = $settings;
            $org->save();

            Money::flush();

            return $touched;
        });
    }

    /**
     * Round to 2 decimals rather than the target's minor unit.
     *
     * These are stored amounts, not a rendering: the columns are
     * `decimal(12,2)`, and a JPY salary rounded to whole yen on the way in
     * could not be converted back out again without drifting.
     */
    private function apply(float|int|string|null $amount, float $rate): float
    {
        return round((float) $amount * $rate, 2);
    }
}
