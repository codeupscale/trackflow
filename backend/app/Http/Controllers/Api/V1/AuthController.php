<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ChangePasswordRequest;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Models\Invitation;
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
                'settings' => array_merge(
                    (new \App\Models\Organization)->getDefaultSettings(),
                    ['timezone' => $request->timezone ?? 'America/New_York']
                ),
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

    /** AUTH-02: Login — multi-org aware */
    public function login(LoginRequest $request): JsonResponse
    {
        // Find ALL user rows matching this email (multi-org support)
        $users = User::where('email', $request->email)->get();

        if ($users->isEmpty()) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        // Verify password against at least one matching user row.
        // Password is shared across org rows (same person), so check the first valid one.
        $validUser = null;
        foreach ($users as $candidate) {
            if (Hash::check($request->password, $candidate->password)) {
                $validUser = $candidate;
                break;
            }
        }

        if (!$validUser) {
            AuditService::log('auth.login_failed', $users->first(), ['reason' => 'invalid_password'], $users->first());
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        // Filter to only active users with valid passwords
        $activeUsers = $users->filter(function ($u) use ($request) {
            return $u->is_active && Hash::check($request->password, $u->password);
        });

        if ($activeUsers->isEmpty()) {
            AuditService::log('auth.login_failed', $validUser, ['reason' => 'account_deactivated'], $validUser);
            throw ValidationException::withMessages([
                'email' => ['Your account has been deactivated.'],
            ]);
        }

        // If only one active org, login directly (preserves existing behavior)
        if ($activeUsers->count() === 1) {
            $user = $activeUsers->first();

            // Check SSO enforcement
            $user->load('organization');
            if ($user->organization->enforce_sso && $user->organization->sso_config) {
                throw ValidationException::withMessages([
                    'email' => ['Your organization requires SSO login.'],
                ]);
            }

            return $this->issueTokensAndRespond($user);
        }

        // Multiple orgs — return org selection prompt
        $organizations = $activeUsers->map(function ($u) {
            $u->load('organization');
            return $this->orgSelectionItem($u);
        })->values();

        return response()->json([
            'requires_org_selection' => true,
            'organizations' => $organizations,
        ]);
    }

    /** AUTH-10: Select organization during login (after multi-org detection) */
    public function selectOrganization(Request $request): JsonResponse
    {
        $request->validate([
            'organization_id' => 'required|uuid',
            'email' => 'required_without:id_token|email',
            'password' => 'required_without:id_token|string',
            'id_token' => 'required_without:password|string',
        ]);

        $orgId = $request->organization_id;

        if ($request->filled('id_token')) {
            // Google OAuth flow — verify token and find user in specified org
            $payload = $this->verifyGoogleToken($request->id_token);
            if (!$payload) {
                return response()->json(['message' => 'Invalid Google token.'], 422);
            }

            $email = $payload['email'];
            $user = User::where('email', $email)
                ->where('organization_id', $orgId)
                ->first();

            if (!$user) {
                return response()->json(['message' => 'No account found in the selected organization.'], 404);
            }
        } else {
            // Email/password flow — verify credentials for the specified org
            $user = User::where('email', $request->email)
                ->where('organization_id', $orgId)
                ->first();

            if (!$user || !Hash::check($request->password, $user->password)) {
                return response()->json(['message' => 'Invalid credentials for the selected organization.'], 422);
            }
        }

        if (!$user->is_active) {
            return response()->json(['message' => 'Your account has been deactivated in this organization.'], 403);
        }

        return $this->issueTokensAndRespond($user);
    }

    /** AUTH-11: List organizations for the authenticated user's email */
    public function organizations(Request $request): JsonResponse
    {
        $email = $request->user()->email;

        $users = User::where('email', $email)
            ->where('is_active', true)
            ->with('organization')
            ->get();

        $organizations = $users->map(function ($u) {
            return $this->orgSelectionItem($u);
        })->values();

        return response()->json([
            'data' => $organizations,
            'current_organization_id' => $request->user()->organization_id,
        ]);
    }

    /** AUTH-12: Switch to a different organization (authenticated) */
    public function switchOrganization(Request $request): JsonResponse
    {
        $request->validate([
            'organization_id' => 'required|uuid',
        ]);

        $email = $request->user()->email;
        $orgId = $request->organization_id;

        $targetUser = User::where('email', $email)
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->first();

        if (!$targetUser) {
            return response()->json(['message' => 'No active account found in the selected organization.'], 404);
        }

        // Delete only the current token (preserve other device sessions)
        $request->user()->currentAccessToken()->delete();

        // Issue new tokens for the target org's user row
        $targetUser->tokens()->where('expires_at', '<', now())->delete();

        $token = $targetUser->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $targetUser->createToken('refresh_token', ['refresh'], now()->addDays(30));

        $targetUser->update(['last_active_at' => now()]);
        AuditService::log('auth.switch_org', $targetUser, [
            'from_org' => $request->user()->organization_id,
            'to_org' => $orgId,
        ], $targetUser);

        return response()->json([
            'user' => $this->userResponse($targetUser),
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

        try {
            $status = Password::sendResetLink($request->only('email'));
        } catch (\Exception $e) {
            \Log::error('Password reset email failed', [
                'email' => $request->email,
                'error' => $e->getMessage(),
            ]);

            throw ValidationException::withMessages([
                'email' => ['Unable to send reset link. Please try again later.'],
            ]);
        }

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

    /** AUTH-09: Google OAuth — verify ID token and login/register (multi-org aware) */
    public function googleAuth(Request $request): JsonResponse
    {
        $request->validate([
            'id_token' => 'required|string',
        ]);

        $payload = $this->verifyGoogleToken($request->id_token);
        if (!$payload) {
            return response()->json(['message' => 'Invalid Google token. Please try again.'], 422);
        }

        $email = $payload['email'];
        $name = $payload['name'] ?? ($payload['given_name'] ?? 'User');
        $googleId = $payload['sub'];
        $avatarUrl = $payload['picture'] ?? null;

        // Step 1: Find users by Google SSO provider ID (all orgs)
        $googleUsers = User::where('sso_provider', 'google')
            ->where('sso_provider_id', $googleId)
            ->where('is_active', true)
            ->get();

        if ($googleUsers->isNotEmpty()) {
            // Returning Google user — check for multi-org
            if ($googleUsers->count() === 1) {
                $user = $googleUsers->first();
                return $this->issueTokensAndRespond($user, false, 'google');
            }

            // Multiple orgs linked to this Google account
            $organizations = $googleUsers->map(function ($u) {
                $u->load('organization');
                return $this->orgSelectionItem($u);
            })->values();

            return response()->json([
                'requires_org_selection' => true,
                'auth_method' => 'google',
                'organizations' => $organizations,
            ]);
        }

        // Step 2: Find all users by email (not yet linked to Google)
        $emailUsers = User::where('email', $email)->where('is_active', true)->get();

        if ($emailUsers->isNotEmpty()) {
            // Link Google to ALL existing accounts with this email
            foreach ($emailUsers as $u) {
                $u->update([
                    'sso_provider' => 'google',
                    'sso_provider_id' => $googleId,
                    'avatar_url' => $u->avatar_url ?: $avatarUrl,
                    'email_verified_at' => $u->email_verified_at ?: now(),
                ]);
            }

            if ($emailUsers->count() === 1) {
                return $this->issueTokensAndRespond($emailUsers->first(), false, 'google');
            }

            // Multiple orgs
            $organizations = $emailUsers->map(function ($u) {
                $u->load('organization');
                return $this->orgSelectionItem($u);
            })->values();

            return response()->json([
                'requires_org_selection' => true,
                'auth_method' => 'google',
                'organizations' => $organizations,
            ]);
        }

        // Step 3: No existing user — check for pending invitations
        $pendingInvitations = Invitation::where('email', $email)
            ->whereNull('accepted_at')
            ->where('expires_at', '>', now())
            ->with('organization')
            ->get();

        if ($pendingInvitations->isNotEmpty()) {
            // Auto-accept pending invitations: create User rows in each invited org
            $createdUsers = DB::transaction(function () use ($pendingInvitations, $name, $email, $googleId, $avatarUrl) {
                $users = [];
                foreach ($pendingInvitations as $invitation) {
                    $users[] = User::create([
                        'organization_id' => $invitation->organization_id,
                        'name' => $name,
                        'email' => $email,
                        'password' => Str::random(32),
                        'role' => $invitation->role,
                        'sso_provider' => 'google',
                        'sso_provider_id' => $googleId,
                        'avatar_url' => $avatarUrl,
                        'email_verified_at' => now(),
                    ]);

                    $invitation->update(['accepted_at' => now()]);
                }
                return collect($users);
            });

            // Also create a personal org so the user always has one
            $personalUser = DB::transaction(function () use ($name, $email, $googleId, $avatarUrl) {
                $org = Organization::create([
                    'name' => $name . "'s Organization",
                    'slug' => Str::slug($name) . '-' . Str::random(6),
                    'plan' => 'trial',
                    'trial_ends_at' => now()->addDays(14),
                    'settings' => (new Organization)->getDefaultSettings(),
                ]);

                return User::create([
                    'organization_id' => $org->id,
                    'name' => $name,
                    'email' => $email,
                    'password' => Str::random(32),
                    'role' => 'owner',
                    'sso_provider' => 'google',
                    'sso_provider_id' => $googleId,
                    'avatar_url' => $avatarUrl,
                    'email_verified_at' => now(),
                ]);
            });

            $allUsers = $createdUsers->push($personalUser);

            foreach ($allUsers as $u) {
                AuditService::log('auth.register', $u, ['method' => 'google', 'invitation_accepted' => true], $u);
            }

            if ($allUsers->count() === 1) {
                return $this->issueTokensAndRespond($allUsers->first(), true, 'google');
            }

            // Multiple orgs to choose from
            $organizations = $allUsers->map(function ($u) {
                $u->load('organization');
                return $this->orgSelectionItem($u);
            })->values();

            return response()->json([
                'requires_org_selection' => true,
                'auth_method' => 'google',
                'is_new_user' => true,
                'organizations' => $organizations,
            ], 201);
        }

        // Step 4: No invitations — auto-register as a new org owner
        $user = DB::transaction(function () use ($name, $email, $googleId, $avatarUrl) {
            $org = Organization::create([
                'name' => $name . "'s Organization",
                'slug' => Str::slug($name) . '-' . Str::random(6),
                'plan' => 'trial',
                'trial_ends_at' => now()->addDays(14),
                'settings' => (new Organization)->getDefaultSettings(),
            ]);

            return User::create([
                'organization_id' => $org->id,
                'name' => $name,
                'email' => $email,
                'password' => Str::random(32),
                'role' => 'owner',
                'sso_provider' => 'google',
                'sso_provider_id' => $googleId,
                'avatar_url' => $avatarUrl,
                'email_verified_at' => now(),
            ]);
        });

        AuditService::log('auth.register', $user, ['method' => 'google'], $user);

        return $this->issueTokensAndRespond($user, true, 'google');
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

    /** AUTH-08: Change password (requires current password) */
    public function changePassword(ChangePasswordRequest $request): JsonResponse
    {
        $user = $request->user();
        $user->loadMissing('organization');

        // SSO users should not be able to change local passwords.
        if (! empty($user->sso_provider) || ! empty($user->sso_provider_id) || (($user->organization->enforce_sso ?? false) && ! empty($user->organization->sso_config))) {
            throw ValidationException::withMessages([
                'password' => ['Your organization requires SSO login. Password changes are disabled.'],
            ]);
        }

        $user->forceFill([
            'password' => $request->password,
            'remember_token' => Str::random(60),
        ])->save();

        // Revoke all tokens (web + desktop) and return fresh tokens so current session stays logged in.
        $user->tokens()->delete();

        $token = $user->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $user->createToken('refresh_token', ['refresh'], now()->addDays(30));

        AuditService::log('auth.password_changed', $user, [], $user);

        return response()->json([
            'message' => 'Password updated successfully.',
            'access_token' => $token->plainTextToken,
            'refresh_token' => $refreshToken->plainTextToken,
            'token_type' => 'Bearer',
        ]);
    }

    // ── Private Helpers ──────────────────────────────────────────────────────

    /** Verify a Google ID token and return the payload, or null on failure. */
    private function verifyGoogleToken(string $idToken): ?array
    {
        $clientId = config('services.google.client_id');
        if (empty($clientId)) {
            return null;
        }

        $response = \Illuminate\Support\Facades\Http::get('https://oauth2.googleapis.com/tokeninfo', [
            'id_token' => $idToken,
        ]);

        if ($response->failed()) {
            return null;
        }

        $payload = $response->json();

        // Verify audience matches our client ID
        if (($payload['aud'] ?? '') !== $clientId) {
            return null;
        }

        $email = $payload['email'] ?? null;
        $googleId = $payload['sub'] ?? null;

        if (!$email || !$googleId) {
            return null;
        }

        return $payload;
    }

    /** Issue access + refresh tokens and return a standard login response. */
    private function issueTokensAndRespond(User $user, bool $isNewUser = false, string $method = 'email'): JsonResponse
    {
        $user->tokens()->where('expires_at', '<', now())->delete();

        $token = $user->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $user->createToken('refresh_token', ['refresh'], now()->addDays(30));

        $user->update(['last_active_at' => now()]);
        AuditService::log($isNewUser ? 'auth.register' : 'auth.login', $user, ['method' => $method], $user);

        return response()->json([
            'user' => $this->userResponse($user),
            'access_token' => $token->plainTextToken,
            'refresh_token' => $refreshToken->plainTextToken,
            'token_type' => 'Bearer',
        ], $isNewUser ? 201 : 200);
    }

    /** Format a user row for the org selection list. */
    private function orgSelectionItem(User $user): array
    {
        $user->loadMissing('organization');

        return [
            'organization_id' => $user->organization_id,
            'organization_name' => $user->organization->name,
            'organization_slug' => $user->organization->slug,
            'organization_plan' => $user->organization->plan,
            'organization_avatar' => $user->organization->avatar_url ?? null,
            'user_role' => $user->role,
            'user_id' => $user->id,
        ];
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
