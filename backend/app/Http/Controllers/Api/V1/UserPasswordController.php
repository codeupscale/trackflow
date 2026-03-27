<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\AuditService;
use App\Services\UserPasswordService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class UserPasswordController extends Controller
{
    public function __construct(private readonly UserPasswordService $userPasswordService) {}

    public function reset(Request $request, string $id): JsonResponse
    {
        $actor = $request->user();
        $target = $actor->organization->users()->findOrFail($id);

        $validated = $request->validate([
            'generate' => ['sometimes', 'boolean'],
            'password' => ['required_unless:generate,true', 'string', 'min:8', 'confirmed'],
        ]);

        $generate = (bool) ($validated['generate'] ?? false);

        if ($generate) {
            $generatedPassword = $this->userPasswordService->resetWithGeneratedPassword($actor, $target);
            AuditService::log('user.password_reset', $target, [
                'actor_role' => $actor->role,
                'generate' => true,
            ], $actor);

            return response()->json([
                'message' => 'Password reset successfully.',
                'user_id' => $target->id,
                'generated_password' => $generatedPassword,
            ]);
        }

        if (! array_key_exists('password', $validated) || ! is_string($validated['password'])) {
            throw ValidationException::withMessages([
                'password' => ['The password field is required.'],
            ]);
        }

        $this->userPasswordService->resetWithPassword($actor, $target, $validated['password']);
        AuditService::log('user.password_reset', $target, [
            'actor_role' => $actor->role,
            'generate' => false,
        ], $actor);

        return response()->json([
            'message' => 'Password reset successfully.',
            'user_id' => $target->id,
        ]);
    }
}

