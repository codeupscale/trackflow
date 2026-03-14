<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class InvitationController extends Controller
{
    /** AUTH-09: Create invitation */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'role' => ['required', 'in:admin,manager,employee'],
        ]);

        $user = $request->user();

        // Check if user already exists in org
        $existing = User::withoutGlobalScopes()
            ->where('organization_id', $user->organization_id)
            ->where('email', $request->email)
            ->exists();

        if ($existing) {
            return response()->json([
                'message' => 'A user with this email already exists in your organization.',
            ], 422);
        }

        // Check for pending invitation
        $pendingInvite = Invitation::where('email', $request->email)
            ->whereNull('accepted_at')
            ->where('expires_at', '>', now())
            ->exists();

        if ($pendingInvite) {
            return response()->json([
                'message' => 'A pending invitation already exists for this email.',
            ], 422);
        }

        $invitation = Invitation::create([
            'organization_id' => $user->organization_id,
            'email' => $request->email,
            'role' => $request->role,
            'token' => Str::random(64),
            'expires_at' => now()->addDays(7),
            'created_by' => $user->id,
        ]);

        // TODO: Dispatch SendInvitationEmail job

        return response()->json([
            'invitation' => $invitation,
            'message' => 'Invitation sent successfully.',
        ], 201);
    }

    /** AUTH-10: Accept invitation */
    public function accept(Request $request): JsonResponse
    {
        $request->validate([
            'token' => ['required', 'string'],
            'name' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $invitation = Invitation::withoutGlobalScopes()
            ->where('token', $request->token)
            ->whereNull('accepted_at')
            ->first();

        if (!$invitation) {
            return response()->json(['message' => 'Invalid invitation token.'], 404);
        }

        if ($invitation->isExpired()) {
            return response()->json(['message' => 'This invitation has expired.'], 410);
        }

        $user = DB::transaction(function () use ($request, $invitation) {
            $user = User::create([
                'organization_id' => $invitation->organization_id,
                'name' => $request->name,
                'email' => $invitation->email,
                'password' => $request->password,
                'role' => $invitation->role,
                'email_verified_at' => now(),
            ]);

            $invitation->update(['accepted_at' => now()]);

            return $user;
        });

        $token = $user->createToken('access_token', ['*'], now()->addHours(24));
        $refreshToken = $user->createToken('refresh_token', ['refresh'], now()->addDays(30));

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'organization_id' => $user->organization_id,
            ],
            'access_token' => $token->plainTextToken,
            'refresh_token' => $refreshToken->plainTextToken,
            'token_type' => 'Bearer',
        ], 201);
    }
}
