<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\SendEmailNotificationJob;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class InvitationController extends Controller
{
    private function sendInvitationEmail(Invitation $invitation, User $invitedBy): void
    {
        SendEmailNotificationJob::dispatch(
            $invitation->email,
            "You've been invited to join {$invitedBy->organization->name} on TrackFlow",
            'emails.invitation',
            [
                'invitation_url' => config('app.frontend_url', config('app.url')) . '/invitations/accept?token=' . $invitation->token,
                'organization_name' => $invitedBy->organization->name,
                'role' => $invitation->role,
                'invited_by' => $invitedBy->name,
                'expires_at' => $invitation->expires_at->format('F j, Y'),
            ]
        );
    }

    /** AUTH-09: List invitations (pending only) */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $invites = Invitation::query()
            ->where('organization_id', $user->organization_id)
            ->whereNull('accepted_at')
            ->where('expires_at', '>', now())
            ->with('creator:id,name,email')
            ->orderByDesc('created_at')
            ->paginate(50);

        return response()->json($invites);
    }

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

        $this->sendInvitationEmail($invitation, $user->loadMissing('organization'));

        return response()->json([
            'invitation' => $invitation,
            'message' => 'Invitation sent successfully.',
        ], 201);
    }

    /** AUTH-09: Resend invitation (extends expiry) */
    public function resend(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        $invitation = Invitation::where('organization_id', $user->organization_id)->findOrFail($id);

        if ($invitation->isAccepted()) {
            return response()->json(['message' => 'Invitation was already accepted.'], 422);
        }

        // Extend expiry on resend
        $invitation->update(['expires_at' => now()->addDays(7)]);

        $this->sendInvitationEmail($invitation->fresh(), $user->loadMissing('organization'));

        return response()->json(['message' => 'Invitation resent successfully.']);
    }

    /** AUTH-09: Revoke invitation */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $invitation = Invitation::where('organization_id', $user->organization_id)->findOrFail($id);

        if ($invitation->isAccepted()) {
            return response()->json(['message' => 'Cannot revoke an accepted invitation.'], 422);
        }

        $invitation->delete();

        return response()->json(['message' => 'Invitation revoked.']);
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
            $existing = User::withoutGlobalScopes()
                ->where('organization_id', $invitation->organization_id)
                ->where('email', $invitation->email)
                ->exists();
            if ($existing) {
                abort(422, 'A user with this email already exists in this organization.');
            }

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
