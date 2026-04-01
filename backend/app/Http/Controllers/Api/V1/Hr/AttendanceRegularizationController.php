<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreAttendanceRegularizationRequest;
use App\Models\AttendanceRegularization;
use App\Services\AttendanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AttendanceRegularizationController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
    ) {}

    /**
     * List regularizations. Manager sees team, employee sees own.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = AttendanceRegularization::where('organization_id', $user->organization_id)
            ->with([
                'user:id,name,email,avatar_url',
                'attendanceRecord:id,date,status,total_hours',
                'reviewedBy:id,name,email',
            ]);

        if ($user->hasRole('owner', 'admin')) {
            // See all
        } elseif ($user->isManager()) {
            $teamMemberIds = $user->managedTeams()
                ->with('members:id')
                ->get()
                ->flatMap(fn ($team) => $team->members->pluck('id'))
                ->push($user->id)
                ->unique()
                ->values();
            $query->whereIn('user_id', $teamMemberIds);
        } else {
            $query->where('user_id', $user->id);
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        $regularizations = $query->orderByDesc('created_at')->paginate(25);

        return response()->json($regularizations);
    }

    /**
     * Request regularization for an attendance record.
     */
    public function store(StoreAttendanceRegularizationRequest $request, string $recordId): JsonResponse
    {
        $reg = $this->attendanceService->requestRegularization(
            $request->user(),
            $recordId,
            $request->validated()
        );

        return response()->json(['data' => $reg->load('attendanceRecord')], 201);
    }

    /**
     * Approve a regularization (manager/admin).
     */
    public function approve(Request $request, string $id): JsonResponse
    {
        $reg = AttendanceRegularization::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('approve', $reg);

        if ($reg->status !== 'pending') {
            return response()->json(['message' => 'Only pending regularizations can be approved.'], 422);
        }

        $result = $this->attendanceService->approveRegularization($reg, $request->user());

        return response()->json(['message' => 'Regularization approved.', 'data' => $result]);
    }

    /**
     * Reject a regularization (manager/admin).
     */
    public function reject(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'review_note' => ['required', 'string', 'max:500'],
        ]);

        $reg = AttendanceRegularization::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('approve', $reg);

        if ($reg->status !== 'pending') {
            return response()->json(['message' => 'Only pending regularizations can be rejected.'], 422);
        }

        $result = $this->attendanceService->rejectRegularization(
            $reg,
            $request->user(),
            $request->input('review_note')
        );

        return response()->json(['message' => 'Regularization rejected.', 'data' => $result]);
    }
}
