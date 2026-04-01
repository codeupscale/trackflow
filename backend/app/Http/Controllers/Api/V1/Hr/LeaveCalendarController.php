<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Models\PublicHoliday;
use App\Services\LeaveService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LeaveCalendarController extends Controller
{
    public function __construct(
        private readonly LeaveService $leaveService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'month' => 'required|integer|min:1|max:12',
            'year' => 'required|integer|min:2020|max:2100',
        ]);

        $user = $request->user();
        $orgId = $user->organization_id;
        $month = (int) $request->input('month');
        $year = (int) $request->input('year');

        // Get leaves for the month
        $calendar = $this->leaveService->getLeaveCalendar($orgId, $month, $year);

        // Get public holidays for the month
        $startDate = Carbon::create($year, $month, 1)->startOfMonth()->toDateString();
        $endDate = Carbon::create($year, $month, 1)->endOfMonth()->toDateString();

        $holidays = PublicHoliday::where('organization_id', $orgId)
            ->where(function ($q) use ($startDate, $endDate, $month) {
                $q->whereBetween('date', [$startDate, $endDate])
                    ->orWhere(function ($q2) use ($month) {
                        // Recurring holidays: match by month/day regardless of year
                        $q2->where('is_recurring', true)
                            ->whereRaw('EXTRACT(MONTH FROM date) = ?', [$month]);
                    });
            })
            ->orderBy('date')
            ->get(['id', 'name', 'date', 'is_recurring']);

        return response()->json([
            'calendar' => $calendar,
            'holidays' => $holidays,
        ]);
    }
}
