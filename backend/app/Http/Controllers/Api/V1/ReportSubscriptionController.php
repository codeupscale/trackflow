<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\ReportSubscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportSubscriptionController extends Controller
{
    /**
     * GET /api/v1/report-subscriptions
     *
     * List the authenticated user's report subscriptions.
     */
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', ReportSubscription::class);

        $subscriptions = ReportSubscription::where('user_id', $request->user()->id)
            ->paginate(20);

        return response()->json($subscriptions);
    }

    /**
     * POST /api/v1/report-subscriptions
     *
     * Create or update a report subscription (upsert by org+user+type).
     */
    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', ReportSubscription::class);

        $validated = $request->validate([
            'report_type' => 'required|in:weekly_summary,daily_digest',
            'is_active' => 'boolean',
            'day_of_week' => 'nullable|integer|min:1|max:7',
            'send_time' => 'nullable|date_format:H:i:s',
            'timezone' => 'nullable|string|max:100',
        ]);

        $subscription = ReportSubscription::updateOrCreate(
            [
                'organization_id' => $request->user()->organization_id,
                'user_id' => $request->user()->id,
                'report_type' => $validated['report_type'],
            ],
            array_merge($validated, [
                'organization_id' => $request->user()->organization_id,
                'user_id' => $request->user()->id,
            ])
        );

        return response()->json(['data' => $subscription], 201);
    }

    /**
     * DELETE /api/v1/report-subscriptions/{id}
     *
     * Remove a report subscription (own only).
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $subscription = ReportSubscription::findOrFail($id);

        $this->authorize('delete', $subscription);

        $subscription->delete();

        return response()->json(['message' => 'Subscription removed.']);
    }
}
