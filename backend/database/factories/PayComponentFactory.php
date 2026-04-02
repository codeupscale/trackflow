<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\PayComponent;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\PayComponent>
 */
class PayComponentFactory extends Factory
{
    protected $model = PayComponent::class;

    public function definition(): array
    {
        $types = [
            ['name' => 'Housing Allowance', 'type' => 'allowance', 'calc' => 'fixed', 'value' => 500],
            ['name' => 'Transport Allowance', 'type' => 'allowance', 'calc' => 'fixed', 'value' => 200],
            ['name' => 'Superannuation', 'type' => 'deduction', 'calc' => 'percentage', 'value' => 11.5],
            ['name' => 'Income Tax', 'type' => 'tax', 'calc' => 'percentage', 'value' => 32.5],
            ['name' => 'Performance Bonus', 'type' => 'bonus', 'calc' => 'percentage', 'value' => 10],
        ];

        $comp = fake()->randomElement($types);

        return [
            'organization_id' => Organization::factory(),
            'name' => $comp['name'],
            'type' => $comp['type'],
            'calculation_type' => $comp['calc'],
            'value' => $comp['value'],
            'is_taxable' => $comp['type'] === 'allowance',
            'is_mandatory' => fake()->boolean(60),
            'applies_to' => 'all',
        ];
    }

    public function mandatory(): static
    {
        return $this->state(fn () => ['is_mandatory' => true]);
    }
}
