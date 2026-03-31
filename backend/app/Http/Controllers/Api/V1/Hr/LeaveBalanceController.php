<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Models\LeaveBalance;
use App\Services\LeaveService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LeaveBalanceController extends Controller
{
    public function __construct(
        private readonly LeaveService $leaveService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $year = (int) $request->input('year', now()->year);

        // If user_id is provided and requester is manager/admin, show that user's balances
        if ($request->filled('user_id') && $user->hasRole('owner', 'admin', 'manager')) {
            $targetUserId = $request->input('user_id');
            // Verify target user belongs to same org
            $targetUser = $user->organization->users()->findOrFail($targetUserId);
        } else {
            $targetUser = $user;
        }

        // Initialize balances for this year if they don't exist yet
        $this->leaveService->initializeBalances($targetUser, $user->organization_id, $year);

        $balances = LeaveBalance::where('user_id', $targetUser->id)
            ->where('year', $year)
            ->with('leaveType:id,name,code,is_paid')
            ->get();

        return response()->json(['balances' => $balances]);
    }
}
