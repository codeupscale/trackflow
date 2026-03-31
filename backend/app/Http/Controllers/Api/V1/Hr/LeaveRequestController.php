<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Exceptions\InsufficientLeaveBalanceException;
use App\Exceptions\LeaveOverlapException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\ApproveLeaveRequest;
use App\Http\Requests\Hr\StoreLeaveRequestRequest;
use App\Models\LeaveRequest;
use App\Services\LeaveService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LeaveRequestController extends Controller
{
    public function __construct(
        private readonly LeaveService $leaveService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = LeaveRequest::where('organization_id', $user->organization_id)
            ->with(['user:id,name,email,avatar_url', 'leaveType:id,name,code']);

        // Role-based scoping: explicit check for every role — no unsafe fallthrough
        if ($user->hasRole('owner', 'admin')) {
            // Owner/admin see all org requests (no additional filter needed)
        } elseif ($user->isManager()) {
            // Managers see their own + their team members' requests
            $teamMemberIds = $user->managedTeams()
                ->with('members:id')
                ->get()
                ->flatMap(fn ($team) => $team->members->pluck('id'))
                ->push($user->id)
                ->unique()
                ->values();
            $query->whereIn('user_id', $teamMemberIds);
        } else {
            // All other roles (employee, custom) see only their own requests
            $query->where('user_id', $user->id);
        }

        // Filters
        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->filled('leave_type_id')) {
            $query->where('leave_type_id', $request->input('leave_type_id'));
        }

        if ($request->filled('start_date')) {
            $query->where('start_date', '>=', $request->input('start_date'));
        }

        if ($request->filled('end_date')) {
            $query->where('end_date', '<=', $request->input('end_date'));
        }

        $leaveRequests = $query->orderByDesc('created_at')->paginate(25);

        return response()->json($leaveRequests);
    }

    public function store(StoreLeaveRequestRequest $request): JsonResponse
    {
        $data = $request->validated();

        // Handle document upload
        if ($request->hasFile('document')) {
            $data['document_path'] = $request->file('document')->store('leave-documents', 's3');
        }

        try {
            $leaveRequest = $this->leaveService->applyLeave($request->user(), $data);
        } catch (InsufficientLeaveBalanceException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (LeaveOverlapException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['leave_request' => $leaveRequest], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $leaveRequest = LeaveRequest::where('organization_id', $request->user()->organization_id)
            ->with(['user:id,name,email,avatar_url', 'leaveType', 'approver:id,name,email'])
            ->findOrFail($id);

        $this->authorize('view', $leaveRequest);

        return response()->json(['leave_request' => $leaveRequest]);
    }

    public function approve(Request $request, string $leaveRequest): JsonResponse
    {
        $lr = LeaveRequest::where('organization_id', $request->user()->organization_id)
            ->findOrFail($leaveRequest);

        $this->authorize('approve', $lr);

        if ($lr->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be approved.'], 422);
        }

        $result = $this->leaveService->approveLeave($lr, $request->user());

        return response()->json(['message' => 'Leave request approved.', 'leave_request' => $result]);
    }

    public function reject(ApproveLeaveRequest $request, string $leaveRequest): JsonResponse
    {
        $lr = LeaveRequest::where('organization_id', $request->user()->organization_id)
            ->findOrFail($leaveRequest);

        $this->authorize('approve', $lr);

        if ($lr->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be rejected.'], 422);
        }

        $result = $this->leaveService->rejectLeave($lr, $request->user(), $request->validated('rejection_reason'));

        return response()->json(['message' => 'Leave request rejected.', 'leave_request' => $result]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $leaveRequest = LeaveRequest::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('delete', $leaveRequest);

        $this->leaveService->cancelLeave($leaveRequest, $request->user());

        return response()->json(null, 204);
    }
}
