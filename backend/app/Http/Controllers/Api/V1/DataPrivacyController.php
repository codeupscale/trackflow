<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\ExportUserDataJob;
use App\Services\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DataPrivacyController extends Controller
{
    /**
     * GDPR: Request personal data export.
     */
    public function exportData(Request $request): JsonResponse
    {
        $user = $request->user();

        ExportUserDataJob::dispatch($user);

        AuditService::log('data.exported', $user);

        return response()->json([
            'message' => 'Data export initiated. You will receive a download link via email within 24 hours.',
        ]);
    }

    /**
     * GDPR: Delete account and anonymize personal data.
     */
    public function deleteAccount(Request $request): JsonResponse
    {
        $request->validate([
            'password' => 'required|string',
            'confirmation' => 'required|in:DELETE',
        ]);

        $user = $request->user();

        if (!Hash::check($request->password, $user->password)) {
            return response()->json(['message' => 'Invalid password.'], 403);
        }

        // Prevent sole owner from deleting their account
        if ($user->isOwner()) {
            $otherOwners = $user->organization->users()
                ->where('id', '!=', $user->id)
                ->where('role', 'owner')
                ->where('is_active', true)
                ->count();

            if ($otherOwners === 0) {
                return response()->json([
                    'message' => 'Cannot delete the only owner. Transfer ownership first.',
                ], 422);
            }
        }

        AuditService::log('data.account_deleted', $user, [
            'original_email' => $user->email,
        ]);

        // Anonymize PII
        $user->update([
            'name' => 'Deleted User',
            'email' => 'deleted_' . Str::random(16) . '@anonymized.local',
            'avatar_url' => null,
            'is_active' => false,
            'sso_provider' => null,
            'sso_provider_id' => null,
        ]);

        // Revoke all tokens
        $user->tokens()->delete();

        // Soft delete
        $user->delete();

        return response()->json(['message' => 'Account deleted and personal data anonymized.']);
    }

    /**
     * GDPR: Get data processing info.
     */
    public function dataProcessingInfo(): JsonResponse
    {
        return response()->json([
            'data_collected' => [
                'profile' => 'Name, email, timezone, avatar',
                'time_tracking' => 'Time entries with start/end times, projects, tasks, notes',
                'screenshots' => 'Periodic screenshots during active tracking (configurable)',
                'activity' => 'Keyboard/mouse activity scores (no keylogging)',
                'device' => 'OS version, app version (desktop agent)',
            ],
            'data_retention' => [
                'time_entries' => 'Retained for the duration of your subscription',
                'screenshots' => 'Configurable retention (default: 180 days)',
                'activity_logs' => 'Configurable retention (default: 90 days)',
                'audit_logs' => '2 years',
            ],
            'data_processing_purposes' => [
                'Time tracking and productivity analytics',
                'Team management and project reporting',
                'Billing and subscription management',
            ],
            'third_parties' => [
                'Stripe — payment processing',
                'AWS S3 — screenshot storage (encrypted at rest)',
            ],
            'rights' => [
                'access' => 'GET /api/v1/privacy/export',
                'deletion' => 'DELETE /api/v1/privacy/account',
                'portability' => 'GET /api/v1/privacy/export (JSON format)',
            ],
        ]);
    }

    /**
     * Record user consent.
     */
    public function recordConsent(Request $request): JsonResponse
    {
        $request->validate([
            'privacy_policy_version' => 'required|string|max:20',
        ]);

        $request->user()->update([
            'consent_given_at' => now(),
            'privacy_policy_version' => $request->privacy_policy_version,
        ]);

        return response()->json(['message' => 'Consent recorded.']);
    }
}
