<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use App\Models\Timesheet;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimesheetController extends Controller
{
    // TIME-10: Submit timesheet
    public function submit(Request $request): JsonResponse
    {
        $request->validate([
            'period_start' => 'required|date',
            'period_end' => 'required|date|after_or_equal:period_start',
        ]);

        $user = $request->user();

        $totalSeconds = TimeEntry::where('user_id', $user->id)
            ->whereBetween('started_at', [$request->period_start, $request->period_end])
            ->whereNotNull('ended_at')
            ->sum('duration_seconds');

        $timesheet = Timesheet::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'period_start' => $request->period_start,
            'period_end' => $request->period_end,
            'total_seconds' => $totalSeconds,
            'status' => 'submitted',
            'submitted_at' => now(),
        ]);

        return response()->json(['timesheet' => $timesheet], 201);
    }

    // TIME-11: Review timesheet
    public function review(Request $request, string $id): JsonResponse
    {
        $request->validate([
            'action' => 'required|in:approve,reject',
            'notes' => 'nullable|string|max:1000',
        ]);

        $timesheet = Timesheet::findOrFail($id);
        $this->authorize('review', $timesheet);

        $timesheet->update([
            'status' => $request->action === 'approve' ? 'approved' : 'rejected',
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        return response()->json(['timesheet' => $timesheet->fresh()]);
    }
}
