<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use App\Services\AuditService;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /** AUTH-01: Register new organization + owner */
    public function register(RegisterRequest $request): JsonResponse
    {
        $user = DB::transaction(function () use ($request) {
            $org = Organization::create([
                'name' => $request->company_name,
                'slug' => Str::slug($request->company_name) . '-' . Str::random(6),
                'plan' => 'trial',
                'trial_ends_at' => now()->addDays(14),
                'settings' => [
                    'screenshot_interval' => 5,
                    'blur_screenshots' => false,
                    'idle_timeout' => 5,
                    'timezone' => $request->timezone ?? 'America/New_York',
                    'can_add_manual_time' => true,
                ],
            ]);

            return User::create([
                'organization_id' => $org->id,
                'name' => $request->name,
                'email' => $request->email,
                'password' => $request->password,
                'role' => 'owner',
                'timezone' => $request->timezone ?? 'America/New_York',
            ]);
        });

        $token = $user->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $user->createToken('refresh_token', ['refresh'], now()->addDays(30));

        AuditService::log('auth.register', $user, [], $user);

        return response()->json([
            'user' => $this->userResponse($user),
            'access_token' => $token->plainTextToken,
            'refresh_token' => $refreshToken->plainTextToken,
            'token_type' => 'Bearer',
        ], 201);
    }

    /** AUTH-02: Login */
    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            // Log failed login attempt
            if ($user) {
                AuditService::log('auth.login_failed', $user, ['reason' => 'invalid_password'], $user);
            }
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        if (!$user->is_active) {
            AuditService::log('auth.login_failed', $user, ['reason' => 'account_deactivated'], $user);
            throw ValidationException::withMessages([
                'email' => ['Your account has been deactivated.'],
            ]);
        }

        // Check SSO enforcement
        if ($user->organization->enforce_sso && $user->organization->sso_config) {
            throw ValidationException::withMessages([
                'email' => ['Your organization requires SSO login.'],
            ]);
        }

        // Clean up only expired tokens — allow multi-device sessions (desktop + web + mobile)
        // Like Hubstaff, users must be able to stay logged in on desktop while also using web portal
        $user->tokens()->where('expires_at', '<', now())->delete();

        $token = $user->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $user->createToken('refresh_token', ['refresh'], now()->addDays(30));

        $user->update(['last_active_at' => now()]);
        AuditService::log('auth.login', $user, [], $user);

        return response()->json([
            'user' => $this->userResponse($user),
            'access_token' => $token->plainTextToken,
            'refresh_token' => $refreshToken->plainTextToken,
            'token_type' => 'Bearer',
        ]);
    }

    /** AUTH-03: Refresh token */
    public function refresh(Request $request): JsonResponse
    {
        $user = $request->user();

        // Verify current token has refresh ability
        if (!$user->currentAccessToken()->can('refresh')) {
            return response()->json(['message' => 'Invalid refresh token.'], 401);
        }

        // Delete only the current refresh token (not all tokens — preserve other device sessions)
        $user->currentAccessToken()->delete();

        // Clean up expired tokens
        $user->tokens()->where('expires_at', '<', now())->delete();

        $token = $user->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $user->createToken('refresh_token', ['refresh'], now()->addDays(30));

        return response()->json([
            'access_token' => $token->plainTextToken,
            'refresh_token' => $refreshToken->plainTextToken,
            'token_type' => 'Bearer',
        ]);
    }

    /** AUTH-04: Logout */
    public function logout(Request $request): JsonResponse
    {
        AuditService::log('auth.logout', $request->user());

        if ($token = $request->user()->currentAccessToken()) {
            $token->delete();
        }

        return response()->json(['message' => 'Logged out successfully.']);
    }

    /** AUTH-05: Forgot password */
    public function forgotPassword(Request $request): JsonResponse
    {
        $request->validate(['email' => 'required|email']);

        $status = Password::sendResetLink($request->only('email'));

        if ($status !== Password::RESET_LINK_SENT) {
            throw ValidationException::withMessages([
                'email' => [__($status)],
            ]);
        }

        return response()->json(['message' => 'Password reset link sent.']);
    }

    /** AUTH-06: Reset password */
    public function resetPassword(Request $request): JsonResponse
    {
        $request->validate([
            'token' => 'required',
            'email' => 'required|email',
            'password' => 'required|min:8|confirmed',
        ]);

        $status = Password::reset(
            $request->only('email', 'password', 'password_confirmation', 'token'),
            function (User $user, string $password) {
                $user->forceFill([
                    'password' => $password,
                    'remember_token' => Str::random(60),
                ])->save();
            }
        );

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages([
                'email' => [__($status)],
            ]);
        }

        return response()->json(['message' => 'Password has been reset.']);
    }

    /** AUTH-07: Get current user */
    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'user' => $this->userResponse($request->user()),
        ]);
    }

    /** Update current user profile (e.g. timezone). */
    public function updateProfile(Request $request): JsonResponse
    {
        $valid = $request->validate([
            'timezone' => ['sometimes', 'string', Rule::in(timezone_identifiers_list())],
        ]);

        $user = $request->user();
        if (array_key_exists('timezone', $valid)) {
            $user->timezone = $valid['timezone'];
            $user->save();
        }

        return response()->json([
            'user' => $this->userResponse($user->fresh()),
        ]);
    }

    private function userResponse(User $user): array
    {
        $user->load('organization');

        return [
            'id' => $user->id,
            'organization_id' => $user->organization_id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'timezone' => $user->timezone,
            'avatar_url' => $user->avatar_url,
            'is_active' => $user->is_active,
            'last_active_at' => $user->last_active_at,
            'email_verified_at' => $user->email_verified_at,
            'organization' => [
                'id' => $user->organization->id,
                'name' => $user->organization->name,
                'slug' => $user->organization->slug,
                'plan' => $user->organization->plan,
                'trial_ends_at' => $user->organization->trial_ends_at,
                'settings' => $user->organization->settings,
            ],
        ];
    }
}
