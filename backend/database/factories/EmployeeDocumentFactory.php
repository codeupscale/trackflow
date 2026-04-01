<?php

namespace Database\Factories;

use App\Models\EmployeeDocument;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<EmployeeDocument> */
class EmployeeDocumentFactory extends Factory
{
    protected $model = EmployeeDocument::class;

    public function definition(): array
    {
        $category = fake()->randomElement([
            'id_proof', 'address_proof', 'education', 'experience',
            'contract', 'tax', 'medical', 'other',
        ]);

        $mimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword'];
        $extensions = ['pdf', 'jpg', 'png', 'doc'];
        $mimeIndex = array_rand($mimeTypes);

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'title' => fake()->sentence(3),
            'category' => $category,
            'file_path' => "documents/{$category}/" . fake()->uuid() . '.' . $extensions[$mimeIndex],
            'file_name' => fake()->word() . '.' . $extensions[$mimeIndex],
            'file_size' => fake()->numberBetween(10240, 10485760), // 10KB - 10MB
            'mime_type' => $mimeTypes[$mimeIndex],
            'expiry_date' => fake()->optional(0.3)->dateTimeBetween('now', '+3 years'),
            'is_verified' => false,
            'verified_by' => null,
            'verified_at' => null,
            'notes' => fake()->optional()->sentence(),
        ];
    }

    public function verified(User $verifier = null): static
    {
        return $this->state([
            'is_verified' => true,
            'verified_by' => $verifier?->id ?? User::factory(),
            'verified_at' => now(),
        ]);
    }

    public function expiringSoon(): static
    {
        return $this->state([
            'expiry_date' => fake()->dateTimeBetween('now', '+30 days'),
        ]);
    }

    public function expired(): static
    {
        return $this->state([
            'expiry_date' => fake()->dateTimeBetween('-1 year', '-1 day'),
        ]);
    }
}
