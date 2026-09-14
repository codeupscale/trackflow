<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StorePublicHolidayRequest;
use App\Models\PublicHoliday;
use App\Models\User;
use App\Notifications\HolidayAnnounced;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

class PublicHolidayController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = PublicHoliday::where('organization_id', $request->user()->organization_id)
            ->with('announcer:id,name');

        if ($request->filled('year')) {
            $year = (int) $request->input('year');
            $query->whereYear('date', $year);
        }

        $holidays = $query->orderBy('date')->paginate($request->input('per_page', 100));

        return response()->json($holidays);
    }

    public function store(StorePublicHolidayRequest $request): JsonResponse
    {
        $holiday = PublicHoliday::create([
            'organization_id' => $request->user()->organization_id,
            'announced_by' => $request->user()->id,
            ...$request->validated(),
        ]);

        $this->announce($holiday, $request->user());

        return response()->json(['data' => $holiday->load('announcer:id,name')], 201);
    }

    public function update(StorePublicHolidayRequest $request, string $id): JsonResponse
    {
        $holiday = PublicHoliday::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        // is_pinned is deliberately NOT editable here — the headline is owned
        // by the pin endpoint, which enforces one-at-a-time in a transaction.
        $holiday->update($request->validated());

        return response()->json([
            'message' => 'Holiday updated.',
            'data' => $holiday->fresh()->load('announcer:id,name'),
        ]);
    }

    /**
     * Toggle a holiday as the PINNED org-wide headline. Pinning one unpins any
     * other (at most one headline per org); pinning an already-pinned holiday
     * unpins it, returning the banner to its automatic nearest-upcoming pick.
     */
    public function pin(Request $request, string $id): JsonResponse
    {
        $orgId = $request->user()->organization_id;

        $holiday = PublicHoliday::where('organization_id', $orgId)->findOrFail($id);

        DB::transaction(function () use ($holiday, $orgId) {
            $wasPinned = $holiday->is_pinned;
            PublicHoliday::where('organization_id', $orgId)->where('is_pinned', true)
                ->update(['is_pinned' => false]);
            if (! $wasPinned) {
                $holiday->update(['is_pinned' => true]);
            }
        });

        return response()->json(['data' => $holiday->fresh()->load('announcer:id,name')]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if (! $request->user()->hasRole('owner', 'org_manager', 'hr_manager')) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $holiday = PublicHoliday::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $holiday->delete();

        return response()->json(['message' => 'Holiday removed.']);
    }

    /**
     * Tell the whole organization.
     *
     * The one notification in the product that is genuinely broadcast rather
     * than addressed: a holiday changes when EVERYBODY works. The dashboard
     * banner already shows the next one, but a banner is only seen by whoever
     * opens the app that day — an announcement three months out would scroll
     * past unnoticed.
     *
     * The announcer is excluded; they just created it. Never able to fail the
     * request: the holiday IS created once the row is written.
     */
    private function announce(PublicHoliday $holiday, User $announcer): void
    {
        try {
            $staff = User::withoutGlobalScopes()
                ->where('organization_id', $holiday->organization_id)
                ->where('is_active', true)
                ->whereNull('deleted_at')
                ->where('id', '!=', $announcer->id)
                ->get();

            if ($staff->isEmpty()) {
                return;
            }

            Notification::send($staff, new HolidayAnnounced($holiday));
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
