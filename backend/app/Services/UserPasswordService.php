<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class UserPasswordService
{
    public function resetWithPassword(User $actor, User $target, string $newPassword): void
    {
        $this->assertPasswordResetAllowed($target);

        $target->forceFill([
            'password' => $newPassword,
            'remember_token' => Str::random(60),
        ])->save();

        // Force re-login everywhere (web/desktop/mobile).
        $target->tokens()->delete();
    }

    public function resetWithGeneratedPassword(User $actor, User $target): string
    {
        $this->assertPasswordResetAllowed($target);

        $generated = Str::password(20);

        $target->forceFill([
            'password' => $generated,
            'remember_token' => Str::random(60),
        ])->save();

        // Force re-login everywhere (web/desktop/mobile).
        $target->tokens()->delete();

        return $generated;
    }

    private function assertPasswordResetAllowed(User $target): void
    {
        $target->loadMissing('organization');

        // Match AuthController::changePassword SSO restriction.
        if (! empty($target->sso_provider) || ! empty($target->sso_provider_id) || (($target->organization->enforce_sso ?? false) && ! empty($target->organization->sso_config))) {
            throw ValidationException::withMessages([
                'password' => ['Your organization requires SSO login. Password changes are disabled.'],
            ]);
        }
    }
}

